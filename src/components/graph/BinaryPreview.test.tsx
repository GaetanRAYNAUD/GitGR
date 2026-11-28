import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "../../i18n";
import { BinaryPreview, commitSides, formatSize, workSides } from "./BinaryPreview";

describe("formatSize", () => {
  it("octets, Ko, Mo", () => {
    const u: [string, string, string] = ["o", "Ko", "Mo"];
    expect(formatSize(812, "fr", u)).toBe("812 o");
    expect(formatSize(1536, "fr", u)).toBe("1,5 Ko");
    expect(formatSize(3 * 1024 * 1024, "en", ["B", "KB", "MB"])).toBe("3 MB");
  });
});

describe("versions à comparer", () => {
  const f = (status: string, oldPath: string | null = null) => ({ status, path: "a.png", oldPath });
  it("commit : premier parent ou début de plage ; ajout et suppression sans l'autre côté", () => {
    expect(commitSides("/r", f("M"), "abc")).toEqual({ path: "/r", old: { rev: "abc^", file: "a.png" }, new: { rev: "abc", file: "a.png" } });
    expect(commitSides("/r", f("R", "b.png"), "abc", "base").old).toEqual({ rev: "base", file: "b.png" });
    expect(commitSides("/r", f("A"), "abc").old).toBeNull();
    expect(commitSides("/r", f("D"), "abc").new).toBeNull();
  });
  it("copie de travail : HEAD → index → disque", () => {
    expect(workSides("/r", f("M"), "staged")).toEqual({ path: "/r", old: { rev: "HEAD", file: "a.png" }, new: { rev: "", file: "a.png" } });
    expect(workSides("/r", f("M"), "unstaged")).toEqual({ path: "/r", old: { rev: "", file: "a.png" }, new: { rev: null, file: "a.png" } });
    expect(workSides("/r", f("?"), "untracked")).toEqual({ path: "/r", old: null, new: { rev: null, file: "a.png" } });
    expect(workSides("/r", f("U"), "conflicted")).toBeUndefined();
  });
});

describe("<BinaryPreview />", () => {
  it("images avant / après, écart de taille, bascule en fondu", async () => {
    render(<BinaryPreview sides={{ path: "/r", old: { rev: "x^", file: "logo.png" }, new: { rev: "x", file: "logo.png" } }} />);
    expect(await screen.findByRole("img", { name: "Image avant la modification" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Image après la modification" })).toBeInTheDocument();
    expect(screen.getByText(/1,2 Ko → 1,8 Ko/)).toHaveTextContent("(+650 o)");
    await userEvent.click(screen.getByRole("button", { name: "Fondu" }));
    expect(screen.getByRole("button", { name: "Fondu" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Fondu entre l’image avant et après" })).toHaveAttribute("aria-valuetext", "50 % de la nouvelle image");
  });
  it("autre binaire : la taille seulement", async () => {
    render(<BinaryPreview sides={{ path: "/r", old: null, new: { rev: "x", file: "data.bin" } }} />);
    expect(await screen.findByText("Fichier binaire : pas d’aperçu.")).toBeInTheDocument();
    expect(screen.getByText(/absent → 2 Ko/)).toBeInTheDocument();
  });
});

describe("<BinaryPreview /> image illisible", () => {
  it("remplace l'image cassée par un texte et retire le fondu", async () => {
    const { fireEvent } = await import("@testing-library/react");
    render(<BinaryPreview sides={{ path: "/r", old: { rev: "x^", file: "logo.png" }, new: { rev: "x", file: "logo.png" } }} />);
    fireEvent.error(await screen.findByRole("img", { name: "Image après la modification" }));
    expect(screen.getByText("Image illisible : pas d’aperçu.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fondu" })).toBeNull();
  });
});
