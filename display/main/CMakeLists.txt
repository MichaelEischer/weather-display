idf_component_register(SRCS "main.cpp"
                    INCLUDE_DIRS "."
                    REQUIRES arduino-esp32 GxEPD2 qrcode nvs_flash WifiManager
                    )

# Add NVS partition table
set(PARTITION_TABLE "${CMAKE_CURRENT_SOURCE_DIR}/partitions.csv")
set(PARTITION_TABLE_OFFSET 0x8000)

# Add NVS data
set(NVS_BIN "${CMAKE_CURRENT_BINARY_DIR}/nvs.bin")
set(NVS_CSV "${CMAKE_CURRENT_SOURCE_DIR}/nvs_data.csv")
set(NVS_OFFSET 0x9000)
set(NVS_SIZE 0x6000)

# Generate NVS binary
add_custom_command(
    OUTPUT ${NVS_BIN}
    COMMAND python3 ${IDF_PATH}/components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py
            generate ${NVS_CSV} ${NVS_BIN} ${NVS_SIZE}
    DEPENDS ${NVS_CSV}
)

# Add NVS binary to flash
add_custom_target(nvs_bin ALL DEPENDS ${NVS_BIN})

# Add NVS flashing command
add_custom_target(flash_nvs
    COMMAND ${ESPTOOLPY} --chip ${IDF_TARGET} write_flash ${NVS_OFFSET} ${NVS_BIN}
    DEPENDS ${NVS_BIN}
    COMMENT "Flashing NVS partition"
)
