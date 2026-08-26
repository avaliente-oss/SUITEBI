"use client";

/**
 * Carga del chat de soporte.
 *
 * Se carga bajo demanda, no en cada pantalla: el script de un tercero
 * corre dentro de una aplicación con sesión iniciada, así que entra sólo
 * cuando la persona pidió ayuda, y una sola vez por sesión.
 *
 * El contexto se entrega por las dos vías que usan casi todos los
 * embebidos de chat, para no depender de cuál implemente el proveedor:
 *   · window.davalsyChatContext, para los que leen una variable global
 *   · atributos data-* en la propia etiqueta script, para los que leen
 *     su dataset
 *
 * Cuando sepamos el nombre exacto de los campos que espera el proveedor,
 * se ajusta aquí y en ningún otro lugar.
 */

const WIDGET_URL = process.env.NEXT_PUBLIC_CHAT_WIDGET_URL;
const WIDGET_ID = process.env.NEXT_PUBLIC_CHAT_WIDGET_ID;

export const isSupportChatConfigured = Boolean(WIDGET_URL);

export type SupportContext = {
  email: string;
  fullName: string;
  organizationName: string;
  organizationId: string;
  planName: string;
  role: string;
  screen: string;
};

let cargando: Promise<void> | null = null;

declare global {
  interface Window {
    davalsyChatContext?: SupportContext;
  }
}

/**
 * Abre el chat con el contexto del usuario. Devuelve false si no hay
 * widget configurado, para que quien llame pueda ofrecer otra salida.
 */
export async function openSupportChat(context: SupportContext): Promise<boolean> {
  if (!WIDGET_URL || typeof window === "undefined") return false;

  // El contexto se actualiza siempre, aunque el script ya esté cargado:
  // la persona pudo cambiar de organización o de pantalla.
  window.davalsyChatContext = context;

  if (!cargando) {
    cargando = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = WIDGET_URL;
      script.async = true;
      if (WIDGET_ID) script.dataset.widgetId = WIDGET_ID;

      script.dataset.email = context.email;
      script.dataset.name = context.fullName;
      script.dataset.organization = context.organizationName;
      script.dataset.organizationId = context.organizationId;
      script.dataset.plan = context.planName;
      script.dataset.role = context.role;

      script.onload = () => resolve();
      script.onerror = () => {
        // Si falla, se limpia para poder reintentar en el siguiente clic.
        cargando = null;
        reject(new Error("CHAT_WIDGET_LOAD_FAILED"));
      };

      document.body.appendChild(script);
    });
  }

  try {
    await cargando;
    // Muchos embebidos escuchan un evento para abrirse ya cargados.
    window.dispatchEvent(new CustomEvent("davalsy:open-chat", { detail: context }));
    return true;
  } catch {
    return false;
  }
}
