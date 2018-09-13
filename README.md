# IOT Editor README

VSCode extension for editing FreeIOE Application with connected device

## Features

Loading application from IOT Device.
Editor application code and upload them to device.
Start/Stop application.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `iot_editor.config`: current configuration device selection
* `iot_editor.debug`: shows more information on output if this is true
* `iot_editor.refresh_device_info`: auto refresh connected device information.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 0.1.0

Initial release of vscode extension for FreeeIOE

### 0.2.0

Using websocket instead of http restful api

### 0.2.1

Fixed interval reconnection issue.

### 0.2.2

Fixed log confusion about connection.

### 0.2.3

Update extension description and icon image.

### 1.0.0

Using extented view instead of downloading file to local disk.
Implement device view, application file explorer.

### 1.1.0

Added event viewer.
Shows the information as json file.

### 1.1.1

Support New/Rename/Delete File/Folder.

### 1.2.0

Using FileSystemProvider instread of customized viewer.

### 1.3.0

Remove online configuration, which makes to much noice on workspace file.
