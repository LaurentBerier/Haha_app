import fs from 'node:fs';
import path from 'node:path';

describe('ChatInput image source picker wiring', () => {
  it('wires a source picker modal with library and camera flows', () => {
    const filePath = path.resolve(__dirname, './ChatInput.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('isImageSourceModalVisible');
    expect(source).toContain('imageSourcePickerTitle');
    expect(source).toContain("handlePickImageFrom('library')");
    expect(source).toContain("handlePickImageFrom('camera')");
    expect(source).toContain('ImagePicker.requestMediaLibraryPermissionsAsync()');
    expect(source).toContain('ImagePicker.requestCameraPermissionsAsync()');
    expect(source).toContain('ImagePicker.launchImageLibraryAsync(IMAGE_PICKER_OPTIONS)');
    expect(source).toContain('ImagePicker.launchCameraAsync(IMAGE_PICKER_OPTIONS)');
  });

  it('prepares heavy images through the upload optimization pipeline before send', () => {
    const filePath = path.resolve(__dirname, './ChatInput.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain('prepareImageForUpload');
    expect(source).toContain('sourceSizeBytes: imageAttachment.fileSizeBytes');
    expect(source).toContain('width: imageAttachment.widthPx');
    expect(source).toContain('height: imageAttachment.heightPx');
    expect(source).toContain('MAX_IMAGE_SOURCE_BYTES');
  });
});
