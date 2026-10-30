package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	toolID  = "mini-notes-summarizer"
	version = "0.1.0"
)

var stderr = log.New(os.Stderr, "", log.LstdFlags)

func main() {
	stderr.Println("mini-notes-summarizer started")
	if err := serve(os.Stdin); err != nil {
		stderr.Printf("stdin loop ended: %v", err)
		os.Exit(1)
	}
}

func serve(reader io.Reader) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	session := newSession()
	for scanner.Scan() {
		line := bytes.TrimSpace(append([]byte(nil), scanner.Bytes()...))
		if len(line) == 0 {
			continue
		}
		go session.handleLine(line)
	}
	return scanner.Err()
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type hostReply struct {
	result json.RawMessage
	err    *rpcError
}

type session struct {
	mu      sync.Mutex
	out     *bufio.Writer
	pending map[string]chan hostReply
}

func newSession() *session {
	return &session{
		out:     bufio.NewWriter(os.Stdout),
		pending: map[string]chan hostReply{},
	}
}

func (s *session) handleLine(line []byte) {
	defer func() {
		if recovered := recover(); recovered != nil {
			stderr.Printf("handler panic: %v", recovered)
		}
	}()

	var env struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		Result json.RawMessage `json:"result"`
		Error  *rpcError       `json:"error"`
	}
	if err := json.Unmarshal(line, &env); err != nil {
		_ = s.writeError(json.RawMessage("null"), -32700, "Parse error")
		return
	}
	if env.Method == "" {
		s.deliver(env.ID, env.Result, env.Error)
		return
	}

	switch env.Method {
	case "initialize":
		_ = s.writeResult(env.ID, initializeResult(env.Params))
	case "describe":
		_ = s.writeResult(env.ID, describeManifest())
	case "health":
		_ = s.writeResult(env.ID, map[string]any{"status": "ready", "message": "", "details": map[string]any{}})
	case "shutdown":
		_ = s.writeResult(env.ID, map[string]any{"ok": true})
	case "invoke":
		s.handleInvoke(env.ID, env.Params)
	default:
		_ = s.writeError(env.ID, -32601, "Method not found: "+env.Method)
	}
}

func initializeResult(raw json.RawMessage) map[string]any {
	var params struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	_ = json.Unmarshal(raw, &params)
	protocol := params.ProtocolVersion
	if protocol != "2.0" {
		protocol = "1.1"
	}
	capabilities := map[string]any{}
	if protocol == "2.0" {
		capabilities["sampling"] = map[string]any{}
	}
	return map[string]any{
		"protocolVersion":     protocol,
		"serverInfo":          map[string]any{"name": toolID, "version": version},
		"capabilities":        capabilities,
		"client_capabilities": capabilities,
	}
}

func describeManifest() map[string]any {
	return map[string]any{
		"name":              toolID,
		"display_name":      "Mini Notes Summarizer",
		"version":           version,
		"description":       "Summarize notes by asking the host LLM through sampling.",
		"host_capabilities": []string{"llm.sample"},
		"tools": []map[string]any{
			{
				"name":        "summarize",
				"description": "Summarize the current notes by asking the host LLM.",
				"parameters": []map[string]any{
					{
						"name":        "notes",
						"type":        "array",
						"description": "Notes already loaded from Anna storage.",
						"required":    true,
					},
				},
			},
		},
		"runtime": map[string]any{"type": "binary"},
	}
}

type invokeParams struct {
	Tool      string         `json:"tool"`
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
	Args      map[string]any `json:"args"`
	InvokeID  string         `json:"invoke_id"`
	Context   struct {
		InvokeID string `json:"invoke_id"`
	} `json:"context"`
}

func (s *session) handleInvoke(id, raw json.RawMessage) {
	var params invokeParams
	if err := json.Unmarshal(raw, &params); err != nil {
		_ = s.writeError(id, -32602, "Invalid invoke params")
		return
	}
	tool := params.Tool
	if tool == "" {
		tool = params.Name
	}
	if tool != "summarize" {
		_ = s.writeError(id, -32601, "Unknown tool: "+tool)
		return
	}
	arguments := params.Arguments
	if arguments == nil {
		arguments = params.Args
	}
	notes, err := notesText(arguments["notes"])
	if err != nil {
		_ = s.writeError(id, -32602, err.Error())
		return
	}
	invokeID := params.Context.InvokeID
	if invokeID == "" {
		invokeID = params.InvokeID
	}
	if invokeID == "" {
		invokeID = strings.Trim(string(id), `"`)
	}
	summary, err := s.sample(invokeID, notes)
	if err != nil {
		_ = s.writeError(id, -32603, err.Error())
		return
	}
	_ = s.writeResult(id, map[string]any{
		"success": true,
		"data":    map[string]any{"summary": summary},
	})
}

func notesText(value any) (string, error) {
	items, ok := value.([]any)
	if !ok || len(items) == 0 {
		return "", fmt.Errorf("notes must be a non-empty array")
	}
	var lines []string
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content, _ := row["content"].(string)
		content = strings.TrimSpace(content)
		if content == "" {
			continue
		}
		order := row["order"]
		lines = append(lines, fmt.Sprintf("%v. %s", order, content))
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("notes must include content")
	}
	return strings.Join(lines, "\n"), nil
}

func (s *session) sample(invokeID, notes string) (string, error) {
	requestID := json.RawMessage(strconvQuote(newID()))
	replyCh := make(chan hostReply, 1)
	s.mu.Lock()
	s.pending[string(requestID)] = replyCh
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, string(requestID))
		s.mu.Unlock()
	}()

	params := map[string]any{
		"messages": []map[string]any{
			{
				"role": "user",
				"content": map[string]any{
					"type": "text",
					"text": "Summarize these notes:\n" + notes,
				},
			},
		},
		"maxTokens":      400,
		"systemPrompt":   "You are a concise notes assistant. Summarize the user's notes.",
		"includeContext": "none",
		"metadata":       map[string]any{"executa_invoke_id": invokeID},
	}
	if err := s.writeRequest(requestID, "sampling/createMessage", params); err != nil {
		return "", err
	}

	select {
	case reply := <-replyCh:
		if reply.err != nil {
			msg := strings.TrimSpace(reply.err.Message)
			if msg == "" {
				msg = "sampling/createMessage failed"
			}
			return "", fmt.Errorf("%s", msg)
		}
		var result struct {
			Content struct {
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(reply.result, &result); err != nil {
			return "", fmt.Errorf("invalid sampling response")
		}
		text := strings.TrimSpace(result.Content.Text)
		if text == "" {
			return "", fmt.Errorf("sampling response did not include content.text")
		}
		return text, nil
	case <-time.After(90 * time.Second):
		return "", fmt.Errorf("sampling/createMessage timed out")
	}
}

func (s *session) deliver(id, result json.RawMessage, rpcErr *rpcError) {
	s.mu.Lock()
	replyCh := s.pending[string(id)]
	s.mu.Unlock()
	if replyCh == nil {
		stderr.Printf("unmatched response id=%s", id)
		return
	}
	replyCh <- hostReply{result: result, err: rpcErr}
}

func (s *session) writeRequest(id json.RawMessage, method string, params any) error {
	rawParams, err := json.Marshal(params)
	if err != nil {
		return err
	}
	return s.writeFrame(struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}{"2.0", id, method, rawParams})
}

func (s *session) writeResult(id json.RawMessage, result any) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return s.writeFrame(struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Result  json.RawMessage `json:"result"`
	}{"2.0", normalizeID(id), raw})
}

func (s *session) writeError(id json.RawMessage, code int, message string) error {
	return s.writeFrame(struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      json.RawMessage `json:"id"`
		Error   rpcError        `json:"error"`
	}{"2.0", normalizeID(id), rpcError{Code: code, Message: message}})
}

func (s *session) writeFrame(frame any) error {
	raw, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err = s.out.Write(append(raw, '\n')); err != nil {
		return err
	}
	return s.out.Flush()
}

func normalizeID(id json.RawMessage) json.RawMessage {
	if len(bytes.TrimSpace(id)) == 0 {
		return json.RawMessage("null")
	}
	return id
}

func newID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return hex.EncodeToString(buf)
}

func strconvQuote(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
