import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const names = {
  王老师: "王建国",
  李老师: "李小红",
  孙老师: "孙悦",
  赵老师: "赵明",
};

const teachers = await prisma.teacher.findMany({
  select: { id: true, name: true, phone: true, userId: true, accountUserId: true },
});

for (const teacher of teachers) {
  const nextName = names[teacher.name];
  if (nextName) {
    await prisma.teacher.update({ where: { id: teacher.id }, data: { name: nextName } });
    const userIds = [...new Set([teacher.userId, teacher.accountUserId].filter(Boolean))];
    if (userIds.length > 0) {
      await prisma.user.updateMany({ where: { id: { in: userIds }, name: teacher.name }, data: { name: nextName } });
    }
    console.log(`${teacher.name} -> ${nextName}`);
  }
  if (teacher.phone && !/^\d{11}$/.test(teacher.phone)) {
    await prisma.teacher.update({ where: { id: teacher.id }, data: { phone: null } });
    console.log(`已清掉 ${nextName || teacher.name} 的非数字手机号`);
  }
}

await prisma.$disconnect();
