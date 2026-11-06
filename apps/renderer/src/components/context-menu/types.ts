import type { ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  action?: () => void;
  submenu?: MenuItem[]; // 二级菜单
}
