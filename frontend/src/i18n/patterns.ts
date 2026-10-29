type Translate = (text: string) => string;
type Pattern = [RegExp, (match: RegExpMatchArray, translate: Translate) => string];
const dateField: Record<string, string> = { expectedArrival: '预计到达', actualDispatch: '实际发货', actualArrival: '实际到达' };

/**
 * Sentences from the backend that contain numbers, dates or names, so they cannot be matched word for word.
 * Each pattern rebuilds the Chinese sentence from the captured values. Used only when the language is Chinese.
 */
export const patterns: Pattern[] = [
  // ---- alerts (title / detail) ----
  [/^Latest instruction date (\S+) \((\d+) days before the latest production start\)\.$/, m => `最晚下达指令日期 ${m[1]}（比最晚开工日期早 ${m[2]} 天）。`],
  [/^(\d+) (\S+) are ready at the vendor but not called out for collection\.$/, (m, t) => `${m[1]} ${t(m[2])} 已在供应商处完工，但尚未通知提货。`],
  [/^(\d+) (\S+) called out(?:; vendor committed (\S+))?, not yet received in China\.$/, (m, t) => `${m[1]} ${t(m[2])} 已通知提货${m[3] ? `，供应商承诺 ${m[3]}` : ''}，但中国尚未收到。`],
  [/^(\d+) (\S+) available for loading\.$/, (m, t) => `${m[1]} ${t(m[2])} 可装柜。`],
  [/^(\d+) (\S+) are held\. Resolve the exception to release or remove them\.$/, (m, t) => `${m[1]} ${t(m[2])} 被扣留。请解决异常以释放或移除。`],
  [/^(\d+) (\S+) available in India\.$/, (m, t) => `印度有 ${m[1]} ${t(m[2])} 可用。`],
  [/^Required (\S+)\.$/, m => `要求交货日期 ${m[1]}。`],
  [/^Expected (\S+); verify vendor update\.$/, m => `预计 ${m[1]}；请核实供应商的最新情况。`],
  [/^(.+): exception open$/, (m, t) => `${t(m[1])}：异常未处理`],
  // ---- closing a product line ----
  [/^Short-closed with (\d+) (\S+) undelivered\.\s*(.*)$/, (m, t) => `短交关闭，有 ${m[1]} ${t(m[2])} 未交付。${m[3]}`],
  [/^Delivered in full\.\s*(.*)$/, m => `已全部交付。${m[1]}`],
  // ---- error messages with numbers or names ----
  [/^Receipt exceeds the called-out quantity \(called out (\d+), already received (\d+), this receipt (\d+)\)\. Record a vendor call-out for the rest first\.$/, m => `收货数量超过已通知提货数量（已通知 ${m[1]}，已收 ${m[2]}，本次 ${m[3]}）。请先为剩余部分记录供应商提货通知。`],
  [/^Loading exceeds available China warehouse quantity \((\d+) available(?:, (\d+) in quarantine)?\)\.$/, m => `装柜数量超过中国仓库可用数量（可用 ${m[1]}${m[2] ? `，隔离 ${m[2]}` : ''}）。`],
  [/^Return exceeds delivered quantity \((\d+) delivered\)\.$/, m => `退货数量超过已交付数量（已交付 ${m[1]}）。`],
  [/^Call-out exceeds the order\. (\d+) of (\d+) already called out\.$/, m => `提货通知数量超过订单数量。${m[2]} 件中已通知 ${m[1]} 件。`],
  [/^Only (\d+) units are available in the China warehouse to quarantine\.$/, m => `中国仓库只有 ${m[1]} 件可隔离。`],
  [/^Goods are still in a warehouse, in transit or in quarantine \(China (\d+), loaded (\d+), India (\d+), delivered (\d+)\)\. Deliver or resolve them first\.$/, m => `仍有货物在仓库、运输途中或隔离中（中国 ${m[1]}，已装柜 ${m[2]}，印度 ${m[3]}，已交付 ${m[4]}）。请先交付或处理。`],
  [/^(\d+) (\S+) were never delivered\. Tick "close with the remaining balance" and explain why\.$/, (m, t) => `有 ${m[1]} ${t(m[2])} 从未交付。请勾选“带着剩余数量关闭”并说明原因。`],
  [/^Enter a valid (\w+) date\.$/, m => `请填写有效的${dateField[m[1]] || m[1]}日期。`],
  [/^Text field exceeds (\d+) characters\.$/, m => `文本不能超过 ${m[1]} 个字符。`],
  [/^Number must be between (\d+) and (\d+)\.$/, m => `数字必须在 ${m[1]} 到 ${m[2]} 之间。`],
  [/^Your role \((.+)\) is not allowed to do this\.$/, (m, t) => `您的角色（${t(m[1])}）无权执行此操作。`],
  [/^Row (\d+): product name, vendor and category are required\.$/, m => `第 ${m[1]} 行：产品名称、供应商和类别为必填项。`],
  [/^Row (\d+): choose an existing lead-time category\.$/, m => `第 ${m[1]} 行：请选择已有的周期类别。`],
  [/^Row (\d+): quantity must be a positive whole number\.$/, m => `第 ${m[1]} 行：数量必须是正整数。`],
  [/^Supabase request failed \((\d+)\)\.$/, m => `Supabase 请求失败（${m[1]}）。`],
  [/^OpenAI could not answer \((\d+)\)\./, m => `OpenAI 无法回答（${m[1]}）。`],
];
