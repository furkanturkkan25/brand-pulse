import { PrismaClient } from "@prisma/client";
import { analyzeSentiment } from "../src/lib/sentiment";
import { extractThemes } from "../src/lib/text";

const prisma = new PrismaClient();

async function main() {
  await prisma.mention.deleteMany();
  await prisma.scanRun.deleteMany();
  await prisma.query.deleteMany();

  const query = await prisma.query.create({
    data: {
      name: "Demo Marka",
      keywords: JSON.stringify(["Demo Marka", "DemoMarka"]),
      color: "#0f6e56",
    },
  });

  const samples = [
    { platform: "news", title: "Demo Marka büyüyor", text: "Demo Marka yeni yatırımıyla harika bir dönem geçiriyor, müşteriler memnun.", days: 1, author: "Haber" },
    { platform: "web", title: "Kullanıcı yorumu", text: "Demo Marka ürünü berbat çıktı, hayal kırıklığı yaşadım.", days: 2, author: "Forum" },
    { platform: "reddit", title: "Anyone tried Demo Marka?", text: "Pretty good overall, I recommend it for beginners.", days: 3, author: "u/demo" },
    { platform: "bing", title: "Sektör analizi", text: "Demo Marka orta seviyede; ne çok iyi ne çok kötü.", days: 4, author: "Bing" },
  ];

  for (const s of samples) {
    const { sentiment, score } = analyzeSentiment(s.text);
    const publishedAt = new Date();
    publishedAt.setDate(publishedAt.getDate() - s.days);
    await prisma.mention.create({
      data: {
        queryId: query.id,
        platform: s.platform,
        title: s.title,
        author: s.author,
        text: `${s.title}\n\n${s.text}`,
        publishedAt,
        sentiment,
        score,
        externalId: `seed_${s.platform}_${s.days}`,
        themes: JSON.stringify(extractThemes(s.text)),
      },
    });
  }

  console.log("Seed OK — query:", query.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
