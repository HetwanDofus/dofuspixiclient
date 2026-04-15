import { i18n } from "@lingui/core";

import { messages } from "./locales/fr.po";

i18n.load("fr", messages);
i18n.activate("fr");

export { i18n };
