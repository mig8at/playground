package main

import (
	"context"
	"flag"
	"fmt"
	"strings"

	"creditop/playground/connectors/slack"
)

// Slack por su conector, como el bot. Lo que hacía `slack-mcp`, ahora como comandos de pg con vista
// previa. El mensaje «como yo» (el aviso a QA) sigue en el tablero, que es quien lo decide.

func slackBot() (*slack.Client, int) {
	cfg, err := slack.LoadConfig()
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	cl, err := cfg.Bot()
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	return cl, 0
}

func runSlackPost(args []string) int {
	fs := flag.NewFlagSet("slack post", flag.ContinueOnError)
	channel := fs.String("channel", "", "el id del canal")
	text := fs.String("text", "", "el mensaje")
	apply := applyFlag(fs)
	if fs.Parse(args) != nil {
		return 2
	}
	if strings.TrimSpace(*channel) == "" || strings.TrimSpace(*text) == "" {
		return fail(2, "faltan --channel y --text")
	}
	if code := guarded(*text); code != 0 {
		return code
	}
	cl, code := slackBot()
	if cl == nil {
		return code
	}
	fmt.Printf("  Va a ENVIARSE a Slack, al canal %s, como el bot (%d caracteres):\n\n", *channel, len(*text))
	for _, line := range strings.Split(*text, "\n") {
		fmt.Printf("    │ %s\n", line)
	}
	if !*apply {
		return dryRun()
	}
	msg, err := cl.PostMessage(context.Background(), *channel, *text)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("\n  enviado al canal %s (ts %s)\n", msg.Channel, msg.TS)
	return 0
}

func runSlackChannelCreate(args []string) int {
	fs := flag.NewFlagSet("slack channel-create", flag.ContinueOnError)
	name := fs.String("name", "", "el nombre del canal")
	private := fs.Bool("private", false, "canal privado")
	apply := applyFlag(fs)
	if fs.Parse(args) != nil {
		return 2
	}
	final := slack.NormalizeChannelName(*name)
	if final == "" {
		return fail(2, "falta --name (o no queda nada después de normalizarlo)")
	}
	if code := guarded(final); code != 0 {
		return code
	}
	cl, code := slackBot()
	if cl == nil {
		return code
	}
	kind := "público"
	if *private {
		kind = "privado"
	}
	fmt.Printf("  Va a CREARSE en Slack el canal #%s (%s)\n", final, kind)
	if !*apply {
		return dryRun()
	}
	ch, err := cl.CreateConversation(context.Background(), *name, *private)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("\n  canal #%s creado (id %s)\n", ch.Name, ch.ID)
	return 0
}

func runSlackChannelArchive(args []string) int {
	fs := flag.NewFlagSet("slack channel-archive", flag.ContinueOnError)
	channel := fs.String("channel", "", "el id del canal")
	apply := applyFlag(fs)
	if fs.Parse(args) != nil {
		return 2
	}
	if strings.TrimSpace(*channel) == "" {
		return fail(2, "falta --channel")
	}
	cl, code := slackBot()
	if cl == nil {
		return code
	}
	fmt.Printf("  Va a ARCHIVARSE en Slack el canal %s (queda oculto; se puede desarchivar)\n", *channel)
	if !*apply {
		return dryRun()
	}
	if err := cl.ArchiveConversation(context.Background(), *channel); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("\n  canal %s archivado\n", *channel)
	return 0
}
