#!/bin/bash

# Build script for YggLibrary
# Creates versioned release archives for all platforms or specific platform
# Usage: ./build.sh [platform]
# Platforms: linux, linux-arm64, win, macos, all (default)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
PROJECT_NAME=$(node -p "require('./package.json').name")

DIST_DIR="./dist"
RELEASE_DIR="$DIST_DIR/release"

# Parse arguments
PLATFORM=${1:-all}

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  Building ${GREEN}${PROJECT_NAME} v${VERSION}${NC}        ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Track build results
declare -A BUILD_STATUS
TOTAL_BUILDS=0
SUCCESSFUL_BUILDS=0
FAILED_BUILDS=0

# Function to build specific platform
build_platform() {
    local platform=$1
    echo ""
    echo -e "${BLUE}┌────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC} Building: ${YELLOW}${platform}${NC}"
    echo -e "${BLUE}└────────────────────────────────────────┘${NC}"

    TOTAL_BUILDS=$((TOTAL_BUILDS + 1))

    local build_cmd=""
    case $platform in
        linux)
            build_cmd="npm run build:linux"
            ;;
        linux-arm64)
            build_cmd="npm run build:linux-arm64"
            ;;
        win)
            build_cmd="npm run build:win"
            ;;
        macos)
            build_cmd="npm run build:macos"
            ;;
        *)
            echo -e "${RED}✗ Unknown platform: ${platform}${NC}"
            BUILD_STATUS[$platform]="unknown"
            FAILED_BUILDS=$((FAILED_BUILDS + 1))
            return 1
            ;;
    esac

    # Run build command, ignore non-zero exit codes but check if binary exists
    $build_cmd || true

    # Check if build actually succeeded by looking for the binary
    local binary_path="$DIST_DIR/$platform/ygglibrary"
    if [ "$platform" == "win" ]; then
        binary_path="$DIST_DIR/$platform/ygglibrary.exe"
    fi

    if [ -f "$binary_path" ]; then
        echo -e "${GREEN}✓ Build successful for ${platform}${NC}"
        BUILD_STATUS[$platform]="success"
        SUCCESSFUL_BUILDS=$((SUCCESSFUL_BUILDS + 1))
        return 0
    else
        echo -e "${RED}✗ Build failed for ${platform} (binary not found)${NC}"
        BUILD_STATUS[$platform]="failed"
        FAILED_BUILDS=$((FAILED_BUILDS + 1))
        return 1
    fi
}

# Function to create zip archive
create_archive() {
    local platform=$1
    local src_dir="$DIST_DIR/$platform"

    if [ ! -d "$src_dir" ]; then
        echo -e "${YELLOW}⚠ Directory $src_dir does not exist, skipping archive...${NC}"
        return 1
    fi

    # Use Node.js script for cross-platform archiving
    if node build/archive.js "$platform"; then
        return 0
    else
        echo -e "${RED}✗ Failed to create archive for ${platform}${NC}"
        return 1
    fi
}

# Create release directory
mkdir -p "$RELEASE_DIR"
echo -e "${YELLOW}Cleaning release directory...${NC}"
rm -rf "$RELEASE_DIR"/*
echo ""

# Build based on platform argument
if [ "$PLATFORM" == "all" ]; then
    echo -e "${GREEN}Building all platforms${NC}"

    # Build each platform separately with error handling
    build_platform "linux"
    build_platform "linux-arm64"
    build_platform "win"
    build_platform "macos"

    echo ""
    echo -e "${BLUE}┌────────────────────────────────────────┐${NC}"
    echo -e "${BLUE}│${NC} Creating release archives...          ${BLUE}│${NC}"
    echo -e "${BLUE}└────────────────────────────────────────┘${NC}"

    # Create archives for all platforms (will skip if build failed)
    create_archive "linux"
    create_archive "linux-arm64"
    create_archive "win"
    create_archive "macos"
else
    # Build specific platform
    if build_platform "$PLATFORM"; then
        echo ""
        create_archive "$PLATFORM"
    fi
fi

# Final summary
echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}          ${GREEN}Build Summary${NC}                  ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Total builds:      ${TOTAL_BUILDS}"
echo -e "  ${GREEN}Successful:        ${SUCCESSFUL_BUILDS}${NC}"
if [ $FAILED_BUILDS -gt 0 ]; then
    echo -e "  ${RED}Failed:            ${FAILED_BUILDS}${NC}"
fi
echo ""

# Show build status for each platform
if [ ${#BUILD_STATUS[@]} -gt 0 ]; then
    echo -e "${BLUE}Platform Status:${NC}"
    for platform in "${!BUILD_STATUS[@]}"; do
        status="${BUILD_STATUS[$platform]}"
        if [ "$status" == "success" ]; then
            echo -e "  ${GREEN}✓${NC} $platform"
        else
            echo -e "  ${RED}✗${NC} $platform"
        fi
    done
    echo ""
fi

# List created archives
echo -e "${BLUE}Release archives:${NC}"
if ls "$RELEASE_DIR"/*.zip > /dev/null 2>&1; then
    for archive in "$RELEASE_DIR"/*.zip; do
        if [ -f "$archive" ]; then
            filename=$(basename "$archive")
            size=$(du -h "$archive" 2>/dev/null | cut -f1 || stat -f%z "$archive" 2>/dev/null | awk '{printf "%.2f MB", $1/1024/1024}' || echo "unknown")
            echo -e "  ${filename} (${size})"
        fi
    done
else
    echo -e "${RED}  No archives created${NC}"
fi
echo ""

# Exit with error if all builds failed
if [ $SUCCESSFUL_BUILDS -eq 0 ] && [ $TOTAL_BUILDS -gt 0 ]; then
    echo -e "${RED}All builds failed!${NC}"
    exit 1
fi

echo -e "${GREEN}Done!${NC}"
