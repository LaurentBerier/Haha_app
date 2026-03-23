import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../../i18n';
import { theme } from '../../theme';

export interface AccountMenuItem {
  label: string;
  route: string;
}

interface AccountMenuProps {
  isOpen: boolean;
  isAuthenticated: boolean;
  authMenuLabel: string;
  items: AccountMenuItem[];
  headerHorizontalInset: number;
  onClose: () => void;
  onNavigate: (route: string) => void;
  onAuthAction: () => void;
}

export function AccountMenu({
  isOpen,
  isAuthenticated,
  authMenuLabel,
  items,
  headerHorizontalInset,
  onClose,
  onNavigate,
  onAuthAction
}: AccountMenuProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <View style={styles.menuOverlay}>
      <Pressable style={styles.menuBackdrop} onPress={onClose} testID="account-menu-backdrop" />
      <View style={[styles.menuPanel, Platform.OS === 'web' ? { right: headerHorizontalInset } : null]}>
        <Text style={styles.menuTitle}>{t('settingsAccount')}</Text>
        {items.map((item) => (
          <Pressable
            key={item.route}
            onPress={() => onNavigate(item.route)}
            style={({ pressed }) => [styles.menuItem, pressed ? styles.menuItemPressed : null]}
            accessibilityRole="button"
            testID={`account-menu-item-${item.route.replace(/\//g, '-')}`}
          >
            <Text style={styles.menuItemLabel}>{item.label}</Text>
          </Pressable>
        ))}
        <View style={styles.menuDivider} />
        <Pressable
          onPress={() => {
            onAuthAction();
          }}
          style={({ pressed }) => [
            styles.menuItem,
            pressed ? styles.menuItemPressed : null,
            isAuthenticated ? styles.menuItemDestructive : null
          ]}
          accessibilityRole="button"
          testID="account-menu-auth-action"
        >
          <Text style={[styles.menuItemLabel, isAuthenticated ? styles.menuItemLabelDestructive : null]}>
            {authMenuLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  menuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 1
  },
  menuPanel: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 76 : Platform.select({ ios: 96, default: 86 }),
    right: theme.spacing.md,
    minWidth: 230,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 2
  },
  menuTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: theme.spacing.sm,
    paddingTop: 2
  },
  menuItem: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm
  },
  menuItemPressed: {
    opacity: 0.94
  },
  menuItemDestructive: {
    borderColor: theme.colors.error
  },
  menuItemLabel: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  menuItemLabelDestructive: {
    color: theme.colors.error
  },
  menuDivider: {
    height: 1,
    marginVertical: 2,
    backgroundColor: theme.colors.border
  }
});
