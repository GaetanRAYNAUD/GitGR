// Fenêtres de dialogue demandées par les actions (confirmation, saisie d'un nom) : une à la
// fois, affichée par <DialogHost />. Chaque demande renvoie une promesse résolue par la
// réponse de l'utilisateur (`null` : annulé).

import { create } from "zustand";

export interface Choice {
  id: string;
  label: string;
  /** Action destructive (bouton rouge). */
  danger?: boolean;
}

export interface ChoiceRequest {
  kind: "choice";
  title: string;
  body: string;
  /** De la moins à la plus engageante (la dernière est mise en avant). */
  choices: Choice[];
}

export interface InputRequest {
  kind: "input";
  title: string;
  /** Ligne d'explication sous le titre (point de départ d'une branche…). */
  subtitle?: string;
  label: string;
  initial: string;
  submit: string;
  /** Champ masqué (phrase de passe) : ni valeur initiale affichée, ni correction. */
  secret?: boolean;
  /** Second champ facultatif, sous le premier (URL d'un remote…) ; obligatoire lui aussi. */
  second?: { label: string; initial: string; placeholder?: string; validate?: (value: string) => string | null };
  /** Case à cocher facultative sous le champ. */
  checkbox?: { label: string; checked: boolean };
  /** Message d'erreur pour une valeur refusée, `null` si elle convient. */
  validate?: (value: string) => string | null;
}

export interface InputAnswer {
  value: string;
  checked: boolean;
  /** Valeur du second champ, s'il y en a un. */
  second?: string;
}

/** `id` : numéro de la demande (une nouvelle fenêtre repart d'un état neuf). */
type Pending =
  | { id: number; request: ChoiceRequest; resolve: (id: string | null) => void }
  | { id: number; request: InputRequest; resolve: (answer: InputAnswer | null) => void };

interface DialogStore {
  current: Pending | null;
  /** Propose des choix ; renvoie l'identifiant choisi, `null` si annulé. */
  choose(request: Omit<ChoiceRequest, "kind">): Promise<string | null>;
  /** Demande une valeur (nom de branche…) ; `null` si annulé. */
  input(request: Omit<InputRequest, "kind">): Promise<InputAnswer | null>;
  /** Ferme la fenêtre affichée avec cette réponse. */
  answer(value: string | InputAnswer | null): void;
}

let seq = 0;

export const useDialogs = create<DialogStore>((set, get) => {
  /** Une nouvelle demande remplace (et annule) celle affichée. */
  const replace = (next: Pending) => {
    get().current?.resolve(null);
    set({ current: next });
  };
  return {
    current: null,
    choose: (request) =>
      new Promise((resolve) => replace({ id: ++seq, request: { kind: "choice", ...request }, resolve })),
    input: (request) =>
      new Promise((resolve) => replace({ id: ++seq, request: { kind: "input", ...request }, resolve })),
    answer(value) {
      const cur = get().current;
      if (!cur) return;
      set({ current: null });
      (cur.resolve as (v: typeof value) => void)(value);
    },
  };
});
