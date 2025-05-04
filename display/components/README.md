# arduino-esp32

arduino-esp32 is checked out as a gitsubmodule instead of a managed component.
This is necessary as the version in the espressif registry does not include the XIAO board variants.
I found no way to reconfigure the exclusions there. Thus, just download the dependency manually.

# arduino

The CMakeLists.txt of some projects depend on a component with name `arduino` whereas others expect
`arduino-esp32`. Work around this by a stub component named `arduino` that depends on `arduino-esp32`.

# GxEPD2

The command 0x26 write to the buffer for "RED" pixel, which has no function for the B/W e-ink display.
The changes drop all corresponding code, along with using default implementations where available.
Partial refreshes of only specific display regions are not supported by the display driver. The RAM
area selection is only relevant for updating the RAM content.

Deep Sleep now uses the correct arguments according to the datasheet. A partial update now also
automatically powers down the display.
