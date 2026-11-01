import { useState } from "react";
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Paperclip,
  Plus,
  Printer,
  Receipt,
  Send,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const today = () => new Date().toLocaleDateString("en-CA");
const currency = (value: number | string, code: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(
    Number(value || 0)
  );
const dateLabel = (value: string | Date) => {
  const key =
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(`${key}T12:00:00`));
};
const statusText: Record<string, string> = {
  draft: "Rascunho",
  submitted: "Enviado",
  in_approval: "Em aprovação",
  approved: "Aprovado",
  paid: "Pago",
  rejected: "Rejeitado",
};
const allowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

export function Reimbursements({
  tenantId,
  currency: currencyCode,
}: {
  tenantId: number;
  currency: string;
}) {
  const list = trpc.reimbursements.list.useQuery({ tenantId });
  const config = trpc.tenants.settings.useQuery({ tenantId });
  const create = trpc.reimbursements.createDraft.useMutation();
  const addItem = trpc.reimbursements.addItem.useMutation();
  const upload = trpc.reimbursements.uploadReceipt.useMutation();
  const generatePdf = trpc.reimbursements.generatePdf.useMutation();
  const submit = trpc.reimbursements.submit.useMutation();
  const paid = trpc.reimbursements.markPaid.useMutation();
  const downloadReceipt = trpc.reimbursements.downloadReceipt.useMutation();
  const detailQuery = trpc.reimbursements.detail.useQuery(
    { tenantId, reimbursementId: 0 },
    { enabled: false }
  );
  const [activeId, setActiveId] = useState<number | null>(null);
  const activeRequest = (list.data ?? []).find(row => row.id === activeId);
  const [title, setTitle] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expenseDate, setExpenseDate] = useState(today());
  const [receipt, setReceipt] = useState<File | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<number | null>(null);
  const detail = trpc.reimbursements.detail.useQuery(
    { tenantId, reimbursementId: selectedDetails ?? 0 },
    { enabled: Boolean(selectedDetails) }
  );
  const categories = (config.data?.categories ?? []).filter(
    category => category.active
  );
  const draft = activeRequest?.status === "draft";
  const canPay = Boolean(activeRequest?.canPay);

  const createRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const result = await create.mutateAsync({
        tenantId,
        title: title.trim(),
      });
      setTitle("");
      setActiveId(result.id);
      await list.refetch();
      toast.success("Rascunho criado.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível criar o rascunho."
      );
    }
  };
  const saveItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeId) return;
    try {
      const result = await addItem.mutateAsync({
        tenantId,
        reimbursementId: activeId,
        categoryId: Number(categoryId),
        description: itemDescription.trim(),
        amount: Number(itemAmount),
        expenseDate,
      });
      if (receipt) {
        if (!allowedTypes.includes(receipt.type))
          throw new Error("Use uma imagem JPG, PNG, WebP ou um PDF.");
        if (receipt.size > 5 * 1024 * 1024)
          throw new Error("O recibo precisa ter até 5 MB.");
        await upload.mutateAsync({
          tenantId,
          reimbursementId: activeId,
          itemId: result.id,
          fileName: receipt.name,
          contentType: receipt.type as
            | "image/jpeg"
            | "image/png"
            | "image/webp"
            | "application/pdf",
          dataBase64: await readBase64(receipt),
        });
      }
      setItemDescription("");
      setItemAmount("");
      setReceipt(null);
      const input = document.getElementById(
        "receipt-file"
      ) as HTMLInputElement | null;
      if (input) input.value = "";
      await list.refetch();
      toast.success("Despesa adicionada ao rascunho.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível adicionar a despesa."
      );
    }
  };
  const sendRequest = async () => {
    if (!activeId) return;
    try {
      await submit.mutateAsync({ tenantId, reimbursementId: activeId });
      await list.refetch();
      toast.success("Solicitação enviada para aprovação.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar.");
    }
  };
  const markPaid = async (id: number) => {
    try {
      await paid.mutateAsync({ tenantId, reimbursementId: id });
      await list.refetch();
      toast.success("Pagamento registrado.");
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Não foi possível registrar o pagamento."
      );
    }
  };
  const openPrint = () => {
    setTimeout(() => window.print(), 80);
  };
  const downloadAttachment = async (attachmentId: number) => {
    try {
      const file = await downloadReceipt.mutateAsync({
        tenantId,
        attachmentId,
      });
      const bytes = Uint8Array.from(atob(file.dataBase64), character =>
        character.charCodeAt(0)
      );
      const url = URL.createObjectURL(
        new Blob([bytes], { type: file.contentType })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : "Não foi possível baixar o comprovante."
      );
    }
  };

  if (selectedDetails && detail.data)
    return (
      <section className="page-content">
        <div className="page-heading no-print">
          <div>
            <button
              className="back-link"
              onClick={() => setSelectedDetails(null)}
            >
              <ArrowLeft size={15} /> Voltar aos reembolsos
            </button>
            <h1>
              Nota consolidada<span className="heading-period">.</span>
            </h1>
            <p>
              {detail.data.request.title} ·{" "}
              {dateLabel(detail.data.request.createdAt)}
            </p>
          </div>
          <button className="button button-primary" onClick={openPrint}>
            <Printer size={16} /> Salvar como PDF
          </button>
        </div>
        <div className="receipt-sheet print-sheet">
          <div className="receipt-sheet-brand">
            <span className="brand-mark">
              <span className="persweb-dot" />
              <i />
            </span>
            <span>
              persweb<span className="brand-rh">rh</span>
            </span>
            <span
              className={`status-chip status-${detail.data.request.status}`}
            >
              {statusText[detail.data.request.status]}
            </span>
          </div>
          <div className="receipt-title">
            <div className="eyebrow">
              SOLICITAÇÃO DE REEMBOLSO · #{detail.data.request.id}
            </div>
            <h2>{detail.data.request.title}</h2>
            <p>Consolidado de despesas e comprovantes enviados.</p>
          </div>
          <div className="receipt-items">
            <div className="receipt-table-head">
              <span>DESCRIÇÃO</span>
              <span>CATEGORIA</span>
              <span>DATA</span>
              <span>VALOR</span>
            </div>
            {detail.data.items.map(item => (
              <div className="receipt-table-row" key={item.id}>
                <b>{item.description}</b>
                <span>{item.categoryName}</span>
                <span>{dateLabel(item.expenseDate)}</span>
                <b>{currency(item.amount, currencyCode)}</b>
              </div>
            ))}
          </div>
          <div className="receipt-total">
            <span>Total a reembolsar</span>
            <b>{currency(detail.data.request.totalAmount, currencyCode)}</b>
          </div>
          <button
            className="button button-outline"
            onClick={async () => {
              try {
                const result = await generatePdf.mutateAsync({
                  tenantId,
                  reimbursementId: detail.data.request.id,
                });
                const link = document.createElement("a");
                link.href = `data:application/pdf;base64,${result.dataBase64}`;
                link.download = result.name;
                link.click();
              } catch (e) {
                toast.error(
                  e instanceof Error ? e.message : "Não foi possível gerar o PDF."
                );
              }
            }}
          >
            Gerar Nota/PDF Consolidado
          </button>
          {detail.data.request.rejectionReason && (
            <div className="notice notice-error">
              <b>Solicitação rejeitada</b>
              <span>{detail.data.request.rejectionReason}</span>
            </div>
          )}
          {detail.data.attachments.length > 0 && (
            <section className="receipt-attachments">
              <h3>Comprovantes anexados</h3>
              {detail.data.attachments.map(file => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => void downloadAttachment(file.id)}
                  disabled={downloadReceipt.isPending}
                >
                  <Paperclip size={15} />
                  {file.name}
                  <Download size={14} />
                </button>
              ))}
            </section>
          )}
          <div className="receipt-footer">
            Documento gerado no Pers Web RH · Dados desta solicitação pertencem à
            empresa contratante.
          </div>
        </div>
      </section>
    );

  return (
    <section className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DESPESAS E PRESTAÇÃO DE CONTAS</div>
          <h1>
            Reembolsos<span className="heading-period">.</span>
          </h1>
          <p>Recibos no lugar certo. Próximo passo à vista.</p>
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setActiveId(null);
            document.getElementById("new-expense-title")?.focus();
          }}
        >
          <Plus size={16} /> Nova solicitação
        </button>
      </div>
      <div className="reimburse-layout">
        <div className="panel request-list-panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">SOLICITAÇÕES</div>
              <h2>Suas despesas</h2>
            </div>
            <span className="count-pill">{list.data?.length ?? 0}</span>
          </div>
          <div className="request-list">
            {list.isLoading ? (
              <div className="empty-inline">Carregando…</div>
            ) : (list.data ?? []).length === 0 ? (
              <div className="empty-state">
                <span className="empty-illustration">
                  <Receipt size={23} />
                </span>
                <h3>Nenhuma solicitação.</h3>
                <p>Comece criando um rascunho.</p>
              </div>
            ) : (
              (list.data ?? []).map(request => (
                <button
                  className={`request-list-item ${activeId === request.id ? "selected" : ""}`}
                  key={request.id}
                  onClick={() => {
                    setActiveId(request.id);
                    setSelectedDetails(null);
                  }}
                >
                  <span className="request-list-icon">
                    <Receipt size={17} />
                  </span>
                  <span className="request-list-copy">
                    <b>{request.title}</b>
                    <small>
                      {dateLabel(request.createdAt)} · {request.items.length}{" "}
                      {request.items.length === 1 ? "item" : "itens"}
                    </small>
                    <span className={`status-chip status-${request.status}`}>
                      {statusText[request.status]}
                    </span>
                  </span>
                  <b className="request-list-total">
                    {currency(request.totalAmount, currencyCode)}
                  </b>
                </button>
              ))
            )}
          </div>
          <form className="new-request-form" onSubmit={createRequest}>
            <label htmlFor="new-expense-title">Nova solicitação</label>
            <div className="inline-input">
              <input
                id="new-expense-title"
                maxLength={180}
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Ex.: Viagem a São Paulo"
              />
              <button
                className="button button-primary"
                disabled={create.isPending}
              >
                <Plus size={16} />
              </button>
            </div>
          </form>
        </div>
        <div className="panel request-editor">
          {!activeRequest ? (
            <div className="empty-state editor-empty">
              <span className="empty-illustration">
                <WalletCards size={24} />
              </span>
              <h3>Organize suas despesas.</h3>
              <p>
                Crie uma solicitação ou escolha um item da lista para continuar.
              </p>
              <button
                className="button button-outline"
                onClick={() =>
                  document.getElementById("new-expense-title")?.focus()
                }
              >
                <Plus size={15} /> Criar solicitação
              </button>
            </div>
          ) : (
            <>
              <div className="request-editor-head">
                <div>
                  <div className="eyebrow">
                    {activeRequest.status === "draft"
                      ? "RASCUNHO EDITÁVEL"
                      : "SOLICITAÇÃO"}{" "}
                    · #{activeRequest.id}
                  </div>
                  <h2>{activeRequest.title}</h2>
                  <p>Criada em {dateLabel(activeRequest.createdAt)}</p>
                </div>
                <span className={`status-chip status-${activeRequest.status}`}>
                  {statusText[activeRequest.status]}
                </span>
              </div>
              <div className="expense-items">
                {activeRequest.items.length === 0 ? (
                  <div className="empty-inline">
                    <span>
                      <FileText size={18} />
                    </span>
                    <p>
                      Adicione sua primeira despesa. Você pode incluir vários
                      itens.
                    </p>
                  </div>
                ) : (
                  activeRequest.items.map(item => (
                    <div className="expense-item-row" key={item.id}>
                      <span className="expense-item-icon">
                        <Receipt size={16} />
                      </span>
                      <span className="expense-item-text">
                        <b>{item.description}</b>
                        <small>
                          {item.categoryName} · {dateLabel(item.expenseDate)}
                        </small>
                      </span>
                      <b>{currency(item.amount, currencyCode)}</b>
                    </div>
                  ))
                )}
                {activeRequest.status !== "draft" && (
                  <button
                    className="text-link"
                    onClick={() => setSelectedDetails(activeRequest.id)}
                  >
                    Ver nota consolidada{" "}
                    <ArrowLeft className="arrow-side" size={14} />
                  </button>
                )}
              </div>
              <div className="expense-grand-total">
                <span>Total da solicitação</span>
                <b>{currency(activeRequest.totalAmount, currencyCode)}</b>
              </div>
              {activeRequest.status === "rejected" && (
                <div className="notice notice-error">
                  <b>Rejeitado</b>
                  <span>
                    {activeRequest.rejectionReason ||
                      "Consulte seu gestor para mais detalhes."}
                  </span>
                </div>
              )}
              {draft && (
                <form className="expense-add-form" onSubmit={saveItem}>
                  <div className="form-divider">
                    <span>NOVO ITEM</span>
                  </div>
                  <label>
                    Descrição
                    <input
                      required
                      maxLength={240}
                      value={itemDescription}
                      onChange={e => setItemDescription(e.target.value)}
                      placeholder="Ex.: Almoço com cliente"
                    />
                  </label>
                  <div className="form-two">
                    <label>
                      Categoria
                      <select
                        required
                        value={categoryId}
                        onChange={e => setCategoryId(e.target.value)}
                      >
                        <option value="">Selecione</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                            {cat.limitAmount
                              ? ` · limite ${currency(cat.limitAmount, currencyCode)}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Valor ({currencyCode})
                      <input
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        value={itemAmount}
                        onChange={e => setItemAmount(e.target.value)}
                        placeholder="0,00"
                      />
                    </label>
                  </div>
                  <label>
                    Data da despesa
                    <input
                      required
                      type="date"
                      value={expenseDate}
                      onChange={e => setExpenseDate(e.target.value)}
                    />
                  </label>
                  <label
                    className="file-drop"
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) setReceipt(file);
                    }}
                  >
                    <input
                      id="receipt-file"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      onChange={e => setReceipt(e.target.files?.[0] ?? null)}
                    />
                    <span className="file-drop-icon">
                      <Upload size={17} />
                    </span>
                    <span>
                      <b>
                        {receipt
                          ? receipt.name
                          : "Adicionar recibo ou nota fiscal"}
                      </b>
                      <small>PDF, JPG, PNG ou WebP · até 5 MB</small>
                    </span>
                    {receipt && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={e => {
                          e.preventDefault();
                          setReceipt(null);
                          const input = document.getElementById(
                            "receipt-file"
                          ) as HTMLInputElement;
                          input.value = "";
                        }}
                        aria-label="Remover arquivo"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </label>
                  <button
                    className="button button-outline"
                    disabled={addItem.isPending || upload.isPending}
                  >
                    <Plus size={15} />
                    {upload.isPending
                      ? "Enviando recibo…"
                      : "Adicionar despesa"}
                  </button>
                  <button
                    type="button"
                    className="button button-primary button-wide"
                    disabled={
                      submit.isPending || activeRequest.items.length === 0
                    }
                    onClick={() => void sendRequest()}
                  >
                    <Send size={15} />
                    {submit.isPending ? "Enviando…" : "Enviar para aprovação"}
                  </button>
                </form>
              )}
              {activeRequest.status === "approved" && canPay && (
                <button
                  className="button button-primary button-wide"
                  onClick={() => void markPaid(activeRequest.id)}
                  disabled={paid.isPending}
                >
                  <Check size={15} /> Registrar pagamento
                </button>
              )}
              {activeRequest.status === "in_approval" &&
                activeRequest.currentApproverMembershipId && (
                  <div className="notice notice-info">
                    <Check size={16} />
                    <span>
                      A solicitação está com o responsável designado para
                      aprovação.
                    </span>
                  </div>
                )}
            </>
          )}
        </div>
      </div>
      {selectedDetails && detail.isLoading && (
        <div className="modal-backdrop">
          <div className="panel">
            <p>Carregando nota consolidada…</p>
          </div>
        </div>
      )}
    </section>
  );
}
