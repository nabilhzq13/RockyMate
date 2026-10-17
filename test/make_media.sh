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
# More clips of other walls, each with a different camera movement, for test/clips.py.
pick() { ls data/rcc/datasets/orig_dataset_yolo/*/images/img$1_* | head -n 1; }
# img1: zooming in slowly
ffmpeg -hide_banner -loglevel error -y -loop 1 -t 8 -i "$(pick 1)" \
  -vf "zoompan=z='min(1+0.0011*on,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=576x1080:fps=30" -t 8 -c:v libvpx -b:v 2M -pix_fmt yuv420p media/clip1.webm
# img5: a slow diagonal drift
ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$(pick 5)" \
  -vf "scale=680:1276,crop=576:1080:'52+50*sin(2*PI*t/8)':'98+90*sin(2*PI*t/8)',fps=30" -t 8 -c:v libvpx -b:v 2M -pix_fmt yuv420p media/clip5.webm
# img11: an unsteady hand
ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$(pick 11)" \
  -vf "scale=640:1200,crop=576:1080:'32+10*sin(2*PI*t*1.3)+5*sin(2*PI*t*3.7)':'60+12*sin(2*PI*t*0.9)+6*sin(2*PI*t*2.9)',fps=30" -t 8 -c:v libvpx -b:v 2M -pix_fmt yuv420p media/clip11.webm
# img17: a vertical pan
ffmpeg -hide_banner -loglevel error -y -loop 1 -i "$(pick 17)" \
  -vf "scale=640:1200,crop=640:1136:0:'32+28*sin(2*PI*t/5)',fps=30" -t 8 -c:v libvpx -b:v 2M -pix_fmt yuv420p media/clip17.webm
for n in 1 5 11 16 17; do cp "$(pick $n)" media/wall$n.jpg; done
echo "Test media ready in test/media"
