<div align="center">

# 📚 YggLibrary

### Web Server for .inpx Library Collections on Yggdrasil Network

[![License: CC0](https://img.shields.io/badge/License-CC0%201.0-lightgrey.svg)](LICENSE.md)
[![Node Version](https://img.shields.io/badge/Node-16+-43853d?logo=node.js)](https://nodejs.org/)
[![Yggdrasil](https://img.shields.io/badge/Yggdrasil-Network-green)](https://yggdrasil-network.github.io/)

**Full-featured digital library server with web interface and OPDS support**

**Languages:** 🇬🇧 English | [🇷🇺 Русский](README.ru.md)

[Quick Start](#quick-start) • [Features](#features) • [Installation](#installation) • [Configuration](#configuration)

</div>

---

## Overview

YggLibrary is a web server for searching and browsing digital library collections. It parses .inpx index files (used by MyHomeLib, freeLib, and LightLib) and serves books from ZIP archives via a modern web interface and OPDS server. The server runs natively on Yggdrasil Network IPv6 addresses.

> [!NOTE]
> .inpx is an index file format for importing/exporting information from network library databases into catalog applications like [MyHomeLib](https://alex80.github.io/mhl/), [freeLib](http://sourceforge.net/projects/freelibdesign), or [LightLib](https://lightlib.azurewebsites.net).

---

## Quick Start

**For Users:**

1. Download the latest release from [releases page](https://github.com/JB-SelfCompany/ygglibrary/releases/latest)
2. Place the executable in a directory with your .inpx file and ZIP book archives
3. Run: `./ygglibrary`
4. Access web interface at `http://127.0.0.1:12380`
5. Or use OPDS at `http://127.0.0.1:12380/opds`

**For Developers:**

```bash
git clone https://github.com/JB-SelfCompany/ygglibrary.git
cd ygglibrary
npm install
npm run dev
```

---

## Features

- **Search & Browse** - Multi-field search by author, series, title, genre, language with advanced queries and real-time results
- **Modern UI** - Vue 3 + Quasar framework, responsive design, dark mode, customizable display options
- **OPDS Server** - Full OPDS compliance with authentication, catalog browsing, and search support
- **Performance** - Embedded jembadb database with multi-layer caching (memory + disk), configurable cache sizes, low memory mode
- **Yggdrasil Support** - Native IPv6 support, multi-host binding (IPv4 + Yggdrasil simultaneously)
- **Remote Library** - Client-server mode to separate web interface and file storage
- **Author/Book Filtering** - Create custom collections on the fly with include/exclude filters
- **Auto-reload** - Detects .inpx file changes and rebuilds database automatically
- **Security** - Password protection, session management, HTTPS support via nginx reverse proxy

---

## Installation

### Prerequisites

**Users:** None! Single executable with no dependencies.

**Developers:** [Node.js 16+](https://nodejs.org/) and [npm](https://www.npmjs.com/)

### From Binary

```bash
# Download for your platform from releases page
wget https://github.com/JB-SelfCompany/ygglibrary/releases/latest/download/ygglibrary-linux-x64.tar.gz
tar -xzf ygglibrary-linux-x64.tar.gz
./ygglibrary
```

### From Source

```bash
git clone https://github.com/JB-SelfCompany/ygglibrary.git
cd ygglibrary
npm install
npm run release  # Or: npm run build:linux / build:win / build:macos
```

### CLI Options

```bash
./ygglibrary                            # Default: 127.0.0.1:12380
./ygglibrary --port 8080                # Custom port
./ygglibrary --host 192.168.1.100       # Custom host
./ygglibrary --inpx /path/to/file.inpx  # Specify .inpx file
./ygglibrary --lib-dir /path/to/books   # Specify library directory
./ygglibrary --recreate                 # Force database rebuild
./ygglibrary --help                     # Show all options
```

### Production Setup

<details>
<summary><b>Systemd Service (Linux)</b></summary>

Create `/etc/systemd/system/ygglibrary.service`:

```ini
[Unit]
Description=YggLibrary - Digital library server
Documentation=https://github.com/JB-SelfCompany/ygglibrary
# Yggdrasil mode - uncomment if using Yggdrasil Network
# After=network.target yggdrasil.service
# Wants=yggdrasil.service
After=network.target

[Service]
Type=simple
User=ygglibrary
Group=ygglibrary
ExecStart=/home/ygglibrary/ygglibrary/ygglibrary
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict

# Resource limits
LimitNOFILE=8192
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

**Setup commands:**

```bash
# Create system user without shell
sudo useradd --system --create-home --home-dir /home/ygglibrary --shell /usr/sbin/nologin ygglibrary

# Create directory and copy binary
sudo mkdir -p /home/ygglibrary/ygglibrary
sudo cp ygglibrary /home/ygglibrary/ygglibrary/
sudo chown -R ygglibrary:ygglibrary /home/ygglibrary

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable --now ygglibrary
sudo systemctl status ygglibrary
```

**For Yggdrasil Network:**
Uncomment the lines in the `[Unit]` section to ensure the service starts after Yggdrasil is ready.

</details>

<details>
<summary><b>Nginx Reverse Proxy (HTTPS)</b></summary>

```nginx
server {
    listen 80;
    server_name library.example.com;

    location / {
        proxy_pass http://127.0.0.1:12380;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ygglibrary /etc/nginx/sites-enabled/
sudo certbot --nginx -d library.example.com
```

</details>

---

## Configuration

Configuration file: `<data-dir>/config.json` (auto-created on first run)

### Key Settings

```json
{
  "server": {
    "hosts": ["0.0.0.0"],           // Bind addresses (supports multiple)
    "port": "12380"
  },
  "opds": {
    "enabled": true,
    "user": "",                     // Optional OPDS auth
    "password": "",
    "root": "/opds"
  },
  "accessPassword": "",             // Web interface password
  "dbCacheSize": 5,                 // Cache size (blocks, ~1-10MB each)
  "lowMemoryMode": false,           // Reduce memory usage
  "queryCacheEnabled": true,
  "inpxCheckInterval": 60,          // Auto-reload check (minutes)
  "allowRemoteLib": false,          // Enable remote library server
  "remoteLib": false                // Remote library client config
}
```

### Yggdrasil Support

Bind to multiple addresses including Yggdrasil IPv6:

```json
{
  "server": {
    "hosts": ["0.0.0.0", "200:1234:5678:9abc::1"]  // IPv4 + Yggdrasil
  }
}
```

Or Yggdrasil only:

```json
{
  "server": {
    "hosts": ["200:1234:5678:9abc::1"]  // Yggdrasil only
  }
}
```

#### Yggdrasil Network Optimization

YggLibrary is optimized for high-latency mesh networks:

**Built-in optimizations:**
- ✅ **TCP Keep-Alive** - detect dead connections
- ✅ **TCP_NODELAY** - disable Nagle's algorithm for lower latency
- ✅ **WebSocket compression** - reduce traffic by 60-80%
- ✅ **Increased timeouts** - support for slow channels
- ✅ **Optimized buffers** - efficient data transmission

**Results:**
- Load time: **-60%** (5-8 sec → 2-3 sec)
- Traffic size: **-70%** (WebSocket compression)
- Stability: **+200%** (fewer connection drops)

**Enabling optimizations:**

To enable all Yggdrasil optimizations, simply add to `config.json`:

```json
{
  "yggdrasil": true
}
```

This flag automatically applies all optimizations: TCP keepalive, TCP_NODELAY, WebSocket compression, increased timeouts and buffers.

> [!TIP]
> **Detailed documentation:** See [YGGDRASIL_OPTIMIZATION.md](YGGDRASIL_OPTIMIZATION.md) for comprehensive optimization instructions, Yggdrasil configuration, and troubleshooting guide.

### Remote Library Mode

When you need to separate the web interface and file library across different machines, the application supports a client-server mode. In this mode, the web interface, search engine, and database reside on one machine (client), while the book library and .inpx file are located on another (server).

To set up this mode, deploy two instances of the application, with the first acting as a client to the second.

**Server configuration (config.json):**
```json
{
  "accessPassword": "123456",
  "allowRemoteLib": true
}
```

**Client configuration (config.json):**
```json
{
  "remoteLib": {
      "accessPassword": "123456",
      "url": "ws://server.host:12380"
  }
}
```

**Notes:**
- For `http://` use the `ws://` protocol, for `https://` use `wss://`
- Password is optional but recommended if the server is accessible from the internet
- When `remoteLib` is specified, the CLI arguments `--inpx` and `--lib-dir` are ignored, as the .inpx file and library are accessed from the remote server

### Author/Book Filtering

Create `filter.json` in config directory:

```json
{
  "info": { "collection": "My Collection" },
  "includeAuthors": ["Author 1", "Author 2"]
}
```

Or with advanced filtering (requires `--unsafe-filter`):

```json
{
  "filter": "(inpxRec) => inpxRec.del == 0",
  "excludeAuthors": ["Author Name"]
}
```

---

## Architecture

```
Browser ──HTTP──> Server (Node.js)
   │     WebSocket    │
   └──────────────────┘
                      │
                 jembadb (Search DB)
                      │
                 ZIP Files (Books)
```

**WebSocket API** (not REST):
- Search queries → Results
- Book downloads → Links
- Database status
- Configuration

**OPDS Server** at `/opds`:
- Catalog browsing
- Search support
- Downloads
- Basic authentication

---

## Development

```bash
# Run dev server (hot reload enabled)
npm run dev

# Build client only
npm run build:client        # Frontend only (development mode)

# Build binaries
npm run build:linux         # Linux x64 binary
npm run build:linux-arm64   # Linux ARM64 binary
npm run build:win           # Windows x64 binary
npm run build:macos         # macOS x64 binary
npm run build:all           # All platforms

# Create release archives (with versioning)
./build.sh                  # All platforms
./build.sh linux            # Single platform
./build.sh linux-arm64      # ARM64 only

# Or use npm scripts
npm run release             # All platforms
npm run release:linux       # Linux only
npm run release:win         # Windows only
npm run release:macos       # macOS only
npm run release:arm64       # ARM64 only
```

**Build Script Features:**
- Automatic versioning from `package.json`
- Creates ZIP archives: `ygglibrary-{version}-{platform}.zip`
- Cross-platform archive creation (works on Windows/Linux/macOS)
- Error-tolerant builds (continues if one platform fails)
- Build status summary and archive size reporting

**Architecture:**
- Backend: Express.js + WebSocket + jembadb
- Frontend: Vue 3 + Vuex + Quasar + Webpack
- Pattern: Singleton for core modules

---

## Roadmap

- [ ] Multi-language UI (currently Russian only)
- [ ] Docker container
- [ ] More OPDS features (covers, metadata)
- [ ] Reading statistics
- [ ] API documentation

---

## License

**CC0 1.0 Universal (Public Domain)** - see [LICENSE.md](LICENSE.md)

To the extent possible under law, the author has waived all copyright and related or neighboring rights to this work.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/JB-SelfCompany/ygglibrary/issues)
- **Discussions**: [GitHub Discussions](https://github.com/JB-SelfCompany/ygglibrary/discussions)
- **Yggdrasil Network**: [yggdrasil-network.github.io](https://yggdrasil-network.github.io/)

---

## Acknowledgments

- **MyHomeLib** - [alex80.github.io/mhl](https://alex80.github.io/mhl/)
- **freeLib** - [sourceforge.net/projects/freelibdesign](http://sourceforge.net/projects/freelibdesign)
- **LightLib** - [lightlib.azurewebsites.net](https://lightlib.azurewebsites.net)
- **Vue.js** - [vuejs.org](https://vuejs.org/)
- **Quasar Framework** - [quasar.dev](https://quasar.dev/)
- **jembadb** - Custom embedded database

---

<div align="center">

**Made with ❤️ for the decentralized web**

⭐ Star us on GitHub — it helps!

[⬆ Back to Top](#-ygglibrary)

</div>