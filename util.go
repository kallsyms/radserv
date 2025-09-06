package main

import (
	"path/filepath"
	"strings"
)

// isMDMFile returns true if the filename's stem ends with _MDM (case-insensitive).
// Used to hide metadata sidecar files that do not contain valid radar data.
func isMDMFile(name string) bool {
	base := filepath.Base(name)
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	return strings.HasSuffix(strings.ToUpper(stem), "_MDM")
}
