type TabFactory = () => Promise<void>;

/**
 * Creates a lazy loader for a tab module.
 * - First call: imports and initializes the module
 * - Subsequent calls: no-op (cached)
 * - Shows/hides loading indicator during load
 */
export function createTabLoader(factory: TabFactory): () => Promise<void> {
  let loaded = false;
  let loading: Promise<void> | null = null;

  return async () => {
    if (loaded) return;
    if (loading) return loading;

    const indicator = document.getElementById("tabLoadingIndicator");
    indicator?.classList.add("is-visible");

    loading = factory()
      .then(() => {
        loaded = true;
      })
      .finally(() => {
        indicator?.classList.remove("is-visible");
        loading = null;
      });

    return loading;
  };
}
