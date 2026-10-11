"use client";

import { useId, useRef, useState } from "react";

type DocumentRow = {
  id: number;
  title: string;
  instructions: string;
  required: boolean;
};

type InitialDocument = Pick<DocumentRow, "title" | "instructions" | "required">;

const MAX_DOCUMENTS = 20;

export function ServiceDocumentFields({ initialDocuments = [] }: { initialDocuments?: InitialDocument[] }) {
  const [documents, setDocuments] = useState<DocumentRow[]>(() => initialDocuments.slice(0, MAX_DOCUMENTS).map((document, id) => ({
    id,
    title: document.title.slice(0, 180),
    instructions: document.instructions.slice(0, 2000),
    required: document.required,
  })));
  const nextId = useRef(documents.length);
  const idPrefix = useId();

  function addDocument() {
    const id = nextId.current++;
    setDocuments((current) => current.length < MAX_DOCUMENTS
      ? [...current, { id, title: "", instructions: "", required: true }]
      : current);
  }

  function updateDocument(id: number, changes: Partial<Omit<DocumentRow, "id">>) {
    setDocuments((current) => current.map((document) =>
      document.id === id ? { ...document, ...changes } : document));
  }

  function removeDocument(id: number) {
    setDocuments((current) => current.filter((document) => document.id !== id));
  }

  return (
    <section className="staff-document-fields" aria-label="Документы для услуги">
      <input
        type="hidden"
        name="documents"
        value={JSON.stringify(documents.map(({ title, instructions, required }) => ({ title, instructions, required })))}
      />
      <div className="staff-document-fields-head">
        <div>
          <h3>Документы для услуги</h3>
          <p>Укажите, какие документы нужно запросить при открытии дела.</p>
        </div>
        <span>{documents.length} / {MAX_DOCUMENTS}</span>
      </div>

      {documents.length === 0 && <p className="staff-document-empty">Документы пока не добавлены.</p>}

      <div className="staff-document-list">
        {documents.map((document, index) => (
          <fieldset className="staff-document-row" key={document.id}>
            <legend>Документ {index + 1}</legend>
            <div className="staff-document-row-grid">
              <label htmlFor={`${idPrefix}-title-${document.id}`}>
                Название документа
                <input
                  id={`${idPrefix}-title-${document.id}`}
                  type="text"
                  value={document.title}
                  onChange={(event) => updateDocument(document.id, { title: event.target.value })}
                  maxLength={180}
                  required
                  placeholder="Например: копия паспорта"
                />
              </label>
              <label htmlFor={`${idPrefix}-required-${document.id}`}>
                Статус документа
                <select
                  id={`${idPrefix}-required-${document.id}`}
                  value={document.required ? "required" : "optional"}
                  onChange={(event) => updateDocument(document.id, { required: event.target.value === "required" })}
                >
                  <option value="required">Обязательный</option>
                  <option value="optional">Необязательный</option>
                </select>
              </label>
            </div>
            <label htmlFor={`${idPrefix}-instructions-${document.id}`}>
              Инструкции для клиента
              <textarea
                id={`${idPrefix}-instructions-${document.id}`}
                value={document.instructions}
                onChange={(event) => updateDocument(document.id, { instructions: event.target.value })}
                maxLength={2000}
                rows={3}
                placeholder="Что подготовить и в каком виде загрузить"
              />
            </label>
            <button
              className="staff-document-remove"
              type="button"
              onClick={() => removeDocument(document.id)}
              aria-label={`Удалить документ ${index + 1}`}
            >
              Удалить документ
            </button>
          </fieldset>
        ))}
      </div>

      <button className="staff-document-add" type="button" onClick={addDocument} disabled={documents.length >= MAX_DOCUMENTS}>
        + Добавить документ
      </button>
      {documents.length >= MAX_DOCUMENTS && <span className="staff-form-hint">Можно добавить не более 20 документов.</span>}
    </section>
  );
}
