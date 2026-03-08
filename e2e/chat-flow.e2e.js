describe('Ha-Ha.ai iOS flow', () => {
  const launchArgs = { detoxEnableSynchronization: 0 };
  const launchPermissions = {
    camera: 'YES',
    medialibrary: 'YES',
    microphone: 'YES',
    notifications: 'YES',
    photos: 'YES',
    speech: 'YES'
  };

  const launchFreshApp = async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      launchArgs,
      permissions: launchPermissions
    });
    await device.disableSynchronization();
  };

  const relaunchExistingApp = async () => {
    await device.launchApp({ newInstance: false, launchArgs });
    await device.disableSynchronization();
  };

  const openRoastChatFromHome = async () => {
    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(20000);
    await element(by.id('artist-start-cathy-gauthier')).tap();
    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();
    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
  };

  const ensureRoastChatIsOpen = async () => {
    try {
      await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(2000);
      return;
    } catch {
      await openRoastChatFromHome();
    }
  };

  beforeEach(async () => {
    await launchFreshApp();

    await waitFor(element(by.id('home-screen'))).toBeVisible().withTimeout(20000);
  });

  it('streams an artist response end-to-end', async () => {
    await element(by.id('artist-start-cathy-gauthier')).tap();

    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();

    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('chat-input')).replaceText('Bonjour Cathy');
    await element(by.id('chat-discussion-button')).tap();

    await waitFor(element(by.label('chat-bubble-artist')).atIndex(0)).toBeVisible().withTimeout(20000);
  });

  it('does not crash when app is backgrounded mid-stream', async () => {
    await element(by.id('artist-start-cathy-gauthier')).tap();
    await waitFor(element(by.id('mode-select-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('mode-card-roast')).tap();

    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(10000);
    await element(by.id('chat-input')).replaceText('Test navigation while streaming');
    await element(by.id('chat-discussion-button')).tap();

    await device.sendToHome();
    await relaunchExistingApp();

    await ensureRoastChatIsOpen();
    await expect(element(by.id('chat-input'))).toBeVisible();
  });

  it('persists messages across relaunch', async () => {
    const persistedMessage = 'persist me';

    await openRoastChatFromHome();
    await element(by.id('chat-input')).replaceText(persistedMessage);
    await element(by.id('chat-discussion-button')).tap();

    await waitFor(element(by.label('chat-bubble-artist')).atIndex(0)).toBeVisible().withTimeout(20000);

    await device.sendToHome();
    await relaunchExistingApp();
    await waitFor(element(by.id('chat-screen'))).toBeVisible().withTimeout(20000);
    await waitFor(element(by.text(persistedMessage))).toBeVisible().withTimeout(10000);
  });
});
