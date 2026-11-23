package main

import (
	"testing"

	"gleipnir/internal/config"
	"gleipnir/internal/gitlab"
)

func TestNewSource(t *testing.T) {
	if _, ok := newSource(config.Config{Demo: true}).(demoSource); !ok {
		t.Fatal("demo mode must serve the demo dataset")
	}
	if _, ok := newSource(config.Config{GitLabURL: "https://gitlab.com", Group: "org"}).(*gitlab.Client); !ok {
		t.Fatal("without demo mode, the source is GitLab")
	}
}
