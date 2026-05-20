/**
 * 表单字段 label 包装。所有教师后台弹窗 / 录入表单复用同一份。
 * 不引入边距 prop，统一 mb-1.5（视觉一致优先）。
 */
export default function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-ink-soft mb-1.5 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
