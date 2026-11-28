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

/** Option d'un choix exclusif (boutons radio), avec ce qu'elle fait. */
export interface RadioOption {
  id: string;
  label: string;
  /** Conséquence de l'option, sous son libellé. */
  hint: string;
  /** Libellé du bouton d'action quand elle est choisie. */
  submit: string;
  /** Action destructive : bouton rouge. */
  danger?: boolean;
}

export interface ChoiceRequest {
  kind: "choice";
  title: string;
  body: string;
  /** De la moins à la plus engageante (la dernière est mise en avant). */
  choices: Choice[];
  /** À la place de `choices` : un choix exclusif expliqué, puis un seul bouton d'action. */
  radio?: { label: string; options: RadioOption[]; initial: string };
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
  /** Nom Git (branche, tag, remote, URL) : champs en police à chasse fixe. */
  mono?: boolean;
  /** Second champ facultatif, sous le premier (URL d'un remote…) ; obligatoire lui aussi,
   *  sauf `optional` (message d'un tag annoté…). */
  second?: { label: string; initial: string; placeholder?: string; optional?: boolean; validate?: (value: string) => string | null };
  /** Case à cocher facultative sous le champ. */
  checkbox?: { label: string; checked: boolean };
  /** Liste à cocher facultative (fichiers d'un stash partiel…) : au moins un élément. */
  picks?: { label: string; items: PickItem[]; checked: string[] };
  /** Message d'erreur pour une valeur refusée, `null` si elle convient. */
  validate?: (value: string) => string | null;
  /** Valeurs proposées d'un clic sous le champ (version patch / minor / major d'un tag…). */
  suggestions?: { label: string; items: { label: string; value: string }[] };
}

export interface PickItem {
  id: string;
  label: string;
  /** Précision affichée à droite (dossier, « indexé »…). */
  hint?: string;
}

export interface InputAnswer {
  value: string;
  checked: boolean;
  /** Éléments cochés de la liste, s'il y en a une (dans l'ordre de la liste). */
  picked?: string[];
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
