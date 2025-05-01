# Setup

## arduino-esp32

Manually installed to components using `git clone https://github.com/espressif/arduino-esp32.git --depth 1 -b 3.2.0`.
This is necessary as the version in the espressif registry does not include the XIAO board variants.
I found no way to reconfigure the exclusions there. Thus, just download the dependency manually.

## Adafruit-GFX-Library

The upstream CMakeLists.txt refers the arduino library using the wrong name.
