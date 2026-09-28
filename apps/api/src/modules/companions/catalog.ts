/**
 * Catalogue de voix TASK. Les identifiants sont internes : le mapping vers un fournisseur
 * (ElevenLabs, Cartesia, Piper...) vit dans VoiceProvider (phase 7). L'utilisateur ne voit
 * jamais un id fournisseur.
 */
export const VOICE_CATALOG = [
  { id: "aria", gender: "feminine", label: "Aria", description: "Douce, chaleureuse, posée" },
  { id: "lea", gender: "feminine", label: "Léa", description: "Vive, rieuse, énergique" },
  { id: "noor", gender: "feminine", label: "Noor", description: "Grave, calme, rassurante" },
  { id: "sam", gender: "masculine", label: "Sam", description: "Détendu, complice, chaleureux" },
  { id: "elio", gender: "masculine", label: "Elio", description: "Jeune, dynamique, taquin" },
  { id: "marc", gender: "masculine", label: "Marc", description: "Posé, grave, rassurant" },
  { id: "kai", gender: "neutral", label: "Kai", description: "Neutre, clair, moderne" },
] as const;
