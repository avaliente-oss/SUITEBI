"use client";

/**
 * Carga del chat de soporte (LeadConnector / HighLevel).
 *
 * Se carga bajo demanda, no en cada pantalla: el script de un tercero
 * corre dentro de una aplicación con sesión iniciada, así que entra sólo
 * cuando la persona pidió ayuda, y una sola vez por sesión.
 *
 * Sobre el contexto del usuario: se revisó el loader de LeadConnector y
 * sólo lee atributos de configuración del widget (data-widget-id,
 * data-resources-url y similares). No expone ninguna vía documentada
 * para inyectar correo, organización ni datos del visitante, así que NO
 * se intenta pasarlos por ahí: quedaría un código que aparenta hacer
 * algo que el widget ignora.
 *
 * El contexto se conserva en window.davalsyChatContext por si el widget
 * interno o un script propio dentro de HighLevel llega a leerlo. La vía
 * confiable hoy es otra: el chat pide el correo, y con ese correo el
 * equipo encuentra organización, plan y rol en Panel admin → Usuarios.
 */

const WIDGET_URL = process.env.NEXT_PUBLIC_CHAT_WIDGET_URL;
const WIDGET_ID = process.env.NEXT_PUBLIC_CHAT_WIDGET_ID;
const RESOURCES_URL =
  process.env.NEXT_PUBLIC_CHAT_RESOURCES_URL ??
  "https://widgets.leadconnectorhq.com/chat-widget/loader.js";

export const isSupportChatConfigured = Boolean(WIDGET_URL && WIDGET_ID);

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
 * Abre el chat de soporte. Devuelve false si no hay widget configurado
 * o si el script no cargó, para que quien llame ofrezca otra salida.
 */
export async function openSupportChat(context: SupportContext): Promise<boolean> {
  if (!WIDGET_URL || !WIDGET_ID || typeof window === "undefined") return false;

  // Se actualiza siempre: la persona pudo cambiar de organización o de
  // pantalla desde la última vez que abrió el chat.
  window.davalsyChatContext = context;

  if (!cargando) {
    cargando = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = WIDGET_URL;
      script.async = true;
      // Los dos atributos que el loader sí exige.
      script.setAttribute("data-resources-url", RESOURCES_URL);
      script.setAttribute("data-widget-id", WIDGET_ID);

      script.onload = () => resolve();
      script.onerror = () => {
        // Se limpia para poder reintentar en el siguiente clic.
        cargando = null;
        reject(new Error("CHAT_WIDGET_LOAD_FAILED"));
      };

      document.body.appendChild(script);
    });
  }

  try {
    await cargando;
    return true;
  } catch {
    return false;
  }
}
