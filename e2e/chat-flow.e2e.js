describe('Ha-Ha.ai iOS flow', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      delete: true
    });
  });

  it('streams an artist response end-to-end', async () => {
    await expect(element(by.id('home-screen'))).toBeVisible();
    await element(by.id('artist-start-cathy-gauthier')).tap();

    await expect(element(by.id('chat-screen'))).toBeVisible();
    await element(by.id('chat-input')).replaceText('Bonjour Cathy');
    await element(by.id('chat-send-button')).tap();

    await waitFor(element(by.id('streaming-indicator'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('streaming-indicator'))).toBeNotVisible().withTimeout(20000);
    await expect(element(by.label('chat-bubble-artist')).atIndex(0)).toBeVisible();
  });

  it('does not crash when app is backgrounded mid-stream', async () => {
    await element(by.id('artist-start-cathy-gauthier')).tap();
    await element(by.id('chat-input')).replaceText('Test navigation while streaming');
    await element(by.id('chat-send-button')).tap();

    await waitFor(element(by.id('streaming-indicator'))).toBeVisible().withTimeout(5000);

    await device.sendToHome();
    await device.launchApp({ newInstance: false });

    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
  });

  it('persists messages across relaunch', async () => {
    const persistedMessage = 'persist me';

    await element(by.id('artist-start-cathy-gauthier')).tap();
    await element(by.id('chat-input')).replaceText(persistedMessage);
    await element(by.id('chat-send-button')).tap();

    await waitFor(element(by.id('streaming-indicator'))).toBeVisible().withTimeout(5000);
    await waitFor(element(by.id('streaming-indicator'))).toBeNotVisible().withTimeout(20000);

    await device.terminateApp();
    await device.launchApp({ newInstance: false });

    await expect(element(by.id('home-screen'))).toBeVisible();
    await element(by.id('artist-start-cathy-gauthier')).tap();

    await waitFor(element(by.text(persistedMessage))).toBeVisible().withTimeout(10000);
  });
});
