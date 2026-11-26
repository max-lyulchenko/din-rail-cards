// Imported first. While the cards load, defining an element that is already
// defined is skipped instead of failing: when the cards are loaded twice (say,
// as a HACS resource and by hand), the second copy then does no harm.
const define = customElements.define.bind(customElements);

customElements.define = (
  name: string,
  constructor: CustomElementConstructor,
  options?: ElementDefinitionOptions
) => {
  if (!customElements.get(name)) {
    define(name, constructor, options);
  }
};

/** Define elements as usual again, once the cards are loaded. */
export const restoreDefine = () => {
  customElements.define = define;
};
