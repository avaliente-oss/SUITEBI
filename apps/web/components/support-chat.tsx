"use client";

/**
 * Chat de soporte (LeadConnector / HighLevel).
 *
 * Comportamiento verificado contra el widget real antes de integrarlo:
 *
 *   · Su loader sólo lee atributos de configuración (data-widget-id,
 *     data-resources-url y similares). No hay forma documentada de
 *     inyectarle correo ni organización, así que no se intenta: sería
 *     código aparentando hacer algo que el widget ignora. A quien
 *     escribe se le identifica por el correo que el propio chat pide,
 *     buscándolo en Panel admin → Usuarios.
 *
 *   · Se renderiza en el flujo del documento, sin burbuja flotante. Por
 *     eso vive en su propia pestaña.
 *
 *   · Monta donde esté su etiqueta script, así que el script se inserta
 *     DENTRO del marco de la pestaña. Mover el elemento después no es
 *     opción: reubicar un elemento personalizado dispara su ciclo de
 *     desconexión.
 *
 *   · Al salir y volver a la pestaña, el contenedor anterior ya no
 *     existe y el widget queda huérfano: se descarta y se inyecta de
 *     nuevo. Probado, vuelve a renderizar.
 */

const WIDGET_URL = process.env.NEXT_PUBLIC_CHAT_WIDGET_URL;
const WIDGET_ID = process.env.NEXT_PUBLIC_CHAT_WIDGET_ID;
const RESOURCES_URL =
  process.env.NEXT_PUBLIC_CHAT_RESOURCES_URL ??
  "https://widgets.leadconnectorhq.com/chat-widget/loader.js";

export const isSupportChatConfigured = Boolean(WIDGET_URL && WIDGET_ID);

/** Espera a que el widget aparezca dentro del contenedor. */
function esperarWidget(contenedor: HTMLElement, timeoutMs = 12000): Promise<boolean> {
  if (contenedor.querySelector("chat-widget")) return Promise.resolve(true);

  return new Promise((resolve) => {
    const limite = window.setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      if (contenedor.querySelector("chat-widget")) {
        window.clearTimeout(limite);
        observer.disconnect();
        resolve(true);
      }
    });

    observer.observe(contenedor, { childList: true, subtree: true });
  });
}

/**
 * Carga el chat dentro del contenedor indicado.
 * Devuelve false si no está configurado o si no alcanzó a aparecer.
 */
export async function mountSupportChat(contenedor: HTMLElement): Promise<boolean> {
  if (!isSupportChatConfigured || typeof window === "undefined") return false;

  // Ya está montado aquí: no se toca.
  if (contenedor.querySelector("chat-widget")) return true;

  // Quedó de una visita anterior, fuera de este contenedor: se descarta.
  document.querySelectorAll("chat-widget").forEach((viejo) => viejo.remove());

  const script = document.createElement("script");
  script.src = WIDGET_URL!;
  script.async = true;
  script.setAttribute("data-resources-url", RESOURCES_URL);
  script.setAttribute("data-widget-id", WIDGET_ID!);
  contenedor.appendChild(script);

  return esperarWidget(contenedor);
}
