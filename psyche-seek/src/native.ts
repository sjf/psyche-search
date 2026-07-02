interface PyWebviewApi {
  pick_folder?: () => Promise<string | null>;
}

interface PyWebview {
  api?: PyWebviewApi;
}

function pywebview(): PyWebview | undefined {
  return (window as unknown as { pywebview?: PyWebview }).pywebview;
}

export function hasNativePicker(): boolean {
  return typeof pywebview()?.api?.pick_folder === "function";
}

export async function pickFolderNative(): Promise<string | null> {
  const api = pywebview()?.api;
  if (!api?.pick_folder) {
    return null;
  }
  const result = await api.pick_folder();
  return result || null;
}
