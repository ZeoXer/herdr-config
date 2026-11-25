build:
	mkdir -p bin
	swiftc -swift-version 5 -O -module-cache-path /tmp/swift-module-cache -framework AppKit -framework WebKit -framework Network -o bin/device-preview main.swift

.PHONY: build
