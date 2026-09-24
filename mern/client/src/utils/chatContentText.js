/**
 * The plain text of an assistant reply, whatever shape it arrived in.
 *
 * The backend normally sends a string, but a model reply can come back as a
 * list of content blocks ([{type: "text", text: "..."}]) and once did — and
 * react-markdown asserts on a non-string child, which took the whole app
 * down with "Unexpected value [object Object] for children". The backend now
 * flattens these too; this is the belt to that suspenders, and it also
 * repairs any such reply already persisted in a saved chat thread.
 */
export const chatContentText = (content) => {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : block && typeof block === "object" && typeof block.text === "string"
            ? block.text
            : ""
      )
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return String(content);
};

export default chatContentText;
