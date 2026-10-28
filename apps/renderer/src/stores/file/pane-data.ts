import type { PaneFileData } from './types';

export function emptyPaneData(): PaneFileData {
  return {
    currentPath: '',
    breadcrumb: [],
    entries: [],
    loading: false,
    error: null,
    selectedPaths: new Set(),
    cursorPath: null,
    lastClickedPath: null,
    renameTarget: null,
    searchQuery: '',
    searchOpen: false,
    viewMode: 'details',
    groupBy: 'none',
    fileType: 'all',
  };
}
