import React from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ open, onClose, children }: ModalProps) {
  if (!open) return null;
  
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900/95 border border-white/10 rounded-2xl w-[90vw] max-w-3xl p-4">
        <div className="flex justify-end mb-4">
          <button 
            onClick={onClose} 
            className="px-3 py-1 rounded-xl bg-white/10 hover:bg-white/20 text-white"
          >
            Fechar
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}