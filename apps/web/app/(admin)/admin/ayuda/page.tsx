"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import {
  adminDeleteFaq,
  adminListFaqs,
  adminUpsertFaq,
  describeAdminError,
  getSupabaseBrowserClient,
  type AdminFaq,
} from "@/lib/supabase";

const formVacio = { id: null as string | null, question: "", answer: "", sortOrder: 100, isActive: true };

export default function AdminAyudaPage() {
  const [faqs, setFaqs] = useState<AdminFaq[] | null>(null);
  const [form, setForm] = useState(formVacio);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    try {
      setFaqs(await adminListFaqs(supabase));
    } catch (err) {
      setError(describeAdminError(err));
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() se reutiliza tras cada acción
    load();
  }, []);

  function startEdit(faq: AdminFaq) {
    setForm({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      sortOrder: faq.sortOrder,
      isActive: faq.isActive,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setError("");
    setNotice("");
    setSaving(true);
    try {
      await adminUpsertFaq(supabase, form);
      setForm(formVacio);
      await load();
      setNotice("Pregunta guardada.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(faq: AdminFaq) {
    if (!window.confirm(`¿Eliminar "${faq.question}"?`)) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyId(faq.id);
    try {
      await adminDeleteFaq(supabase, faq.id);
      await load();
      setNotice("Pregunta eliminada.");
    } catch (err) {
      setError(describeAdminError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <span className="section-kicker">DAVALSY / ADMIN</span>
        <h1>Preguntas frecuentes</h1>
        <p>
          Se muestran a los clientes en la pestaña de soporte, debajo del chat. Las desactivadas se
          conservan pero no se publican.
        </p>
      </div>

      {error && <p className="auth-message is-error">{error}</p>}
      {notice && <p className="auth-message is-ok">{notice}</p>}

      <form className="settings-card admin-invite-form" onSubmit={submit}>
        <div className="settings-card-head">
          <span className="settings-icon">{form.id ? <Pencil size={17} /> : <Plus size={17} />}</span>
          <div>
            <h2>{form.id ? "Editar pregunta" : "Nueva pregunta"}</h2>
            <p>Escribe la respuesta como se la darías a un cliente, sin tecnicismos.</p>
          </div>
        </div>

        <div className="settings-form">
          <label>
            Pregunta
            <input
              required
              placeholder="¿Cómo invito a alguien a mi organización?"
              value={form.question}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
            />
          </label>

          <label>
            Respuesta
            <textarea
              required
              rows={5}
              className="faq-textarea"
              placeholder="Entra a Equipo y accesos desde el menú…"
              value={form.answer}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
            />
          </label>

          <div className="admin-invite-grid">
            <label>
              Orden
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
              />
            </label>
            <label className="admin-solution-checkbox">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Publicada
            </label>
          </div>
        </div>

        <div className="admin-solution-form-actions">
          <button className="primary-login settings-submit" type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={16} /> : form.id ? "Guardar cambios" : "Agregar pregunta"}
          </button>
          {form.id && (
            <button type="button" className="admin-solution-cancel" onClick={() => setForm(formVacio)}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <h2 className="admin-section-title">Publicadas</h2>

      {!faqs && !error && <p className="admin-loading">Cargando…</p>}

      <div className="admin-feature-list">
        {faqs?.map((faq) => (
          <div key={faq.id} className="admin-feature-row admin-member-row">
            <div>
              <strong>{faq.question}</strong>
              <p>{faq.answer}</p>
            </div>
            <div className="admin-feature-status">
              <span className={`status-chip ${faq.isActive ? "status-full" : "status-trial"}`}>
                {faq.isActive ? "Publicada" : "Oculta"}
              </span>
              <span className="status-chip">orden {faq.sortOrder}</span>
            </div>
            <div className="admin-feature-actions">
              <button type="button" onClick={() => startEdit(faq)} disabled={busyId === faq.id}>
                <Pencil size={13} /> Editar
              </button>
              <button type="button" onClick={() => remove(faq)} disabled={busyId === faq.id}>
                <Trash2 size={13} /> Eliminar
              </button>
            </div>
          </div>
        ))}

        {faqs?.length === 0 && <p className="admin-loading">Todavía no hay preguntas cargadas.</p>}
      </div>
    </div>
  );
}
