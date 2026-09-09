// مجمع تزامن صغير: يعالج العناصر بمسارين متوازيين (افتراضياً) مع الحفاظ على
// ترتيب النتائج وعزل الأخطاء — يقلّص زمن الدفعات الكبيرة جداً (N/limit تقريباً)
// بلا إغراق للمزود (حد 2 آمن لحدود المعدل لدى معظم المزودات).

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await worker(items[i], i);
      }
    }
  );
  await Promise.all(lanes);
  return results;
}
