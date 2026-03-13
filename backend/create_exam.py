"""生成测试试卷并保存到数据库"""
import asyncio
import json

async def create_exam():
    from app.core.database import AsyncSessionLocal
    from app.services.ai_service import ai_service
    from app.models.learning import ExamPaper, ExamQuestion
    
    weak_words = [
        {"word": "happy", "meaning": "快乐的", "wrong_count": 5},
        {"word": "beautiful", "meaning": "美丽的", "wrong_count": 4},
        {"word": "friend", "meaning": "朋友", "wrong_count": 3},
        {"word": "study", "meaning": "学习", "wrong_count": 3},
        {"word": "play", "meaning": "玩耍", "wrong_count": 2},
    ]
    
    distribution = {
        "choice": 15,
        "cloze_test": 10,
        "fill_blank": 8,
        "spelling": 5,
        "reading": 12
    }
    
    print("🔄 生成试卷中...")
    exam_data = await ai_service.generate_personalized_exam(
        student_name="测试学生",
        weak_words=weak_words,
        question_distribution=distribution,
        difficulty="medium"
    )
    
    print(f"✅ AI生成完成: {len(exam_data['questions'])}题")
    
    async with AsyncSessionLocal() as db:
        exam_paper = ExamPaper(
            user_id=1,
            title=exam_data["title"],
            description=exam_data.get("description", ""),
            total_score=exam_data["total_score"],
            generated_by_ai=True,
            generation_strategy=json.dumps(distribution, ensure_ascii=False)
        )
        
        db.add(exam_paper)
        await db.flush()
        print(f"📄 试卷ID={exam_paper.id}")
        
        for q in exam_data["questions"]:
            correct_answer = q.get("correct_answer", "")
            if isinstance(correct_answer, dict):
                correct_answer = json.dumps(correct_answer, ensure_ascii=False)
            elif not isinstance(correct_answer, str):
                correct_answer = str(correct_answer) if correct_answer else ""
            
            # 处理content字段 - 完形填空可能没有
            question_text = q.get("content", "")
            
            # 处理options
            options = q.get("options", [])
            if q.get("blanks"):
                options = {"blanks": q["blanks"]}
            
            # 处理阅读理解的passage
            if q.get("passage"):
                question_text = json.dumps({
                    "content": question_text,
                    "passage": q["passage"],
                    "passage_id": q.get("passage_id"),
                    "passage_title": q.get("passage_title")
                }, ensure_ascii=False)
            
            # 完形填空特殊处理
            if q.get("question_type") == "cloze_test" and q.get("passage"):
                question_text = json.dumps({
                    "passage": q["passage"],
                    "blanks": q.get("blanks", [])
                }, ensure_ascii=False)
            
            exam_question = ExamQuestion(
                paper_id=exam_paper.id,
                question_type=q["question_type"],
                word_id=None,
                question_text=question_text or "题目",
                options=json.dumps(options, ensure_ascii=False) if options else None,
                correct_answer=correct_answer or "-",
                score=q.get("score", 5),
                order_index=q.get("question_number", 0)
            )
            db.add(exam_question)
        
        await db.commit()
        print(f"✅ {len(exam_data['questions'])}道题目已保存")
        print(f"\n🎉 完成! 试卷ID: {exam_paper.id}")

if __name__ == "__main__":
    asyncio.run(create_exam())
