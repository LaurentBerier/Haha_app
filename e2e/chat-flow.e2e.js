describe('Ha-Ha.ai iOS flow', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      delete: true
    });

    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(20000);
  });

  it('streams an artist response end-to-end', async () => {
    await element(by.id('artist-start-cathy-gauthier')).tap();

    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();

    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('chat-input')).replaceText('Bonjour Cathy');
    await element(by.id('chat-send-button')).tap();

    await waitFor(element(by.label('chat-bubble-artist')).atIndex(0)).toBeVisible().withTimeout(20000);
  });

  it('does not crash when app is backgrounded mid-stream', async () => {
    await element(by.id('artist-start-cathy-gauthier')).tap();
    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();

    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('chat-input')).replaceText('Test navigation while streaming');
    await element(by.id('chat-send-button')).tap();

    await device.sendToHome();
    await device.launchApp({ newInstance: false });

    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(20000);
    await element(by.id('artist-start-cathy-gauthier')).tap();
    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();
    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('chat-input'))).toBeVisible();
  });

  it('persists messages across relaunch', async () => {
    const persistedMessage = 'persist me';

    await element(by.id('artist-start-cathy-gauthier')).tap();
    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();

    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('chat-input')).replaceText(persistedMessage);
    await element(by.id('chat-send-button')).tap();

    await waitFor(element(by.label('chat-bubble-artist')).atIndex(0)).toBeVisible().withTimeout(20000);

    await device.terminateApp();
    await device.launchApp({ newInstance: false });

    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(20000);
    await element(by.id('artist-start-cathy-gauthier')).tap();
    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();

    await waitFor(element(by.text(persistedMessage))).toBeVisible().withTimeout(10000);
  });
});
