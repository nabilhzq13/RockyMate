#!/usr/bin/env bash
# Fetches the public gym photos used by the tests and builds the test clip and
# fake-camera feed. Needs git and ffmpeg (with libvpx). Output is git-ignored.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data media out
if [ ! -d data/rcc ]; then
  git clone --depth 1 https://github.com/KastnerRG/cse145-sp22-CSE237D_Rock_Climbing_Coach.git data/rcc
fi
IMG=$(ls data/rcc/datasets/orig_dataset_yolo/train/images/img13_* | head -n 1)
cp "$IMG" media/wall13.jpg
# A slow vertical pan, like a hand-held phone, as a WebM clip and as a y4m camera feed.
ffmpeg -hide_banner -loglevel error -y -loop 1 -i media/wall13.jpg \
  -vf "scale=640:1200,crop=640:1136:0:'32+28*sin(2*PI*t/5)',fps=30" -t 8 -c:v libvpx -b:v 2M -pix_fmt yuv420p media/clip13.webm
ffmpeg -hide_banner -loglevel error -y -loop 1 -i media/wall13.jpg \
  -vf "scale=640:1200,crop=640:1136:0:'32+28*sin(2*PI*t/5)',fps=15" -t 6 -pix_fmt yuv420p -f yuv4mpegpipe media/cam13.y4m
echo "Test media ready in test/media"
