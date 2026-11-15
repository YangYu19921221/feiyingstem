"""第一条线:「是什么 · 做什么」(一般现在时),10 节小课

101 I am · You are            106 是 还是 做(动作词;有了动作词不要 am is are)
102 He / She / It is          107 他她它 + 动作词: 长尾巴 s
103 We / They are · 好几个     108 尾巴的三种样子: s / es / ies,have → has
104 不是: not                  109 不做: don't / doesn't
105 问一问: Is he …?           110 问一问: Do you …? Does he …?

每节的词只用三四年级课本里的(scripts/check_grammar_vocab.py 对着词库核对)。
写法见 course.py 和 blocks.py 文件头。
"""
from app.grammar.course import F, lesson, watch
from app.grammar.items import fix, gap, hear, order, pick, sort, tap

BE3 = ["am", "is", "are"]

L101 = lesson(
    101, "我是 · 你是", "I am · You are", "说自己用 am,说对面的你用 are",
    steps=[
        watch(
            F("说自己,用 {I}。{I am Amy.}", "I am Amy .", scene="🙋", hl=["i"]),
            F("{I} 后面跟着 {am}。看,圆头扣圆口,刚刚好。", "I am Amy .", scene="🙋", hl=["be"]),
            F("说对面的你,用 {You}。{You are Mike.}", "You are Mike .", scene="👉", hl=["you"]),
            F("{You} 后面跟着 {are}。方头扣方口。", "You are Mike .", scene="👉", hl=["be"]),
        ),
        tap(["I am happy .", "You are happy ."], "be",
            prompt="上面是 {I},下面换成了 {You}。后面哪一块也跟着变了?点一下。", hint="看第二排蓝色的那一块。"),
        pick("I ___ a boy .", BE3, "am", zh="我是男孩。", scene="🙋", wrong={"are": "shape_i", "is": "shape_i"}),
        pick("You ___ tall .", BE3, "are", zh="你很高。", scene="👉", wrong={"am": "shape_you", "is": "shape_you"}),
        watch(F("记住: {I am},{You are}。我用 {am},你用 {are}。", "I am happy .", "You are happy .", hl=["be"])),
    ],
    practice=[
        hear("I am happy .", [("🙋😊", "我很开心"), ("👉😊", "你很开心")]),
        pick("You ___ my friend .", BE3, "are", zh="你是我的朋友。", wrong={"am": "shape_you", "is": "shape_you"}),
        pick("I ___ a student .", BE3, "am", zh="我是学生。", links=False, wrong={"are": "shape_i", "is": "shape_i"}),
        pick("You ___ a good boy .", BE3, "are", zh="你是个好男孩。", links=False,
             wrong={"am": "shape_you", "is": "shape_you"}),
        fix("I are happy .", "be", ["am", "is"], "am", wrong={"is": "shape_i"}),
        order("You are tall .", zh="你很高。"),
    ],
    pool=[
        pick("I ___ tall .", BE3, "am", zh="我很高。", links=False, wrong={"are": "shape_i", "is": "shape_i"}),
        pick("You ___ happy .", BE3, "are", zh="你很开心。", links=False, wrong={"am": "shape_you", "is": "shape_you"}),
        pick("I ___ Amy .", BE3, "am", zh="我是 Amy。", links=False, wrong={"are": "shape_i", "is": "shape_i"}),
        pick("You ___ a girl .", BE3, "are", zh="你是女孩。", links=False, wrong={"am": "shape_you", "is": "shape_you"}),
        fix("You am my friend .", "be", ["are", "is"], "are", wrong={"is": "shape_you"}),
        fix("I is a boy .", "be", ["am", "are"], "am", wrong={"are": "shape_i"}),
        order("I am a girl .", zh="我是女孩。"),
        order("You are my friend .", zh="你是我的朋友。"),
        hear("You are tall .", [("👉", "你很高"), ("🙋", "我很高")]),
    ],
    misc={
        "shape_i": "说自己 {I},后面用 {am}。圆头配圆口。",
        "shape_you": "说你 {You},后面用 {are}。方头配方口。",
    },
    rule=["I am happy .", "You are happy ."], rule_say="我用 {am},你用 {are}。",
)

L102 = lesson(
    102, "他、她、它", "He is · She is · It is", "一个人、一个东西,用 is",
    steps=[
        watch(
            F("一个男生,叫 {He}。{He is Mike.}", "He is Mike .", scene="👦", hl=["he"]),
            F("一个女生,叫 {She}。{She is Amy.}", "She is Amy .", scene="👧", hl=["she"]),
            F("一只小动物、一个东西,叫 {It}。{It is a cat.}", "It is a_cat .", scene="🐱", hl=["it"]),
            F("他、她、它,都是尖头的。尖头配尖口的 {is}。", "He is Mike .", "She is Amy .", "It is a_cat .", hl=["be"]),
        ),
        tap(["I am happy .", "He is happy ."], "be",
            prompt="{I} 换成了 {He}。后面哪一块也跟着变了?点一下。", hint="看第二排蓝色的那一块。"),
        pick("She ___ a girl .", BE3, "is", zh="她是女孩。", scene="👧", wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick("It ___ a dog .", BE3, "is", zh="它是一只狗。", scene="🐶", wrong={"am": "shape_s3", "are": "shape_s3"}),
        watch(
            F("名字、爸爸、一只猫,只要是一个,也是尖头的。{Amy is tall.} {My dad is tall.}",
              "Amy is tall .", "My_dad is tall .", hl=["amy", "my dad"]),
            F("记住: 他、她、它,一个,用 {is}。", "He is tall .", "She is tall .", "It is big .", hl=["be"]),
        ),
    ],
    practice=[
        sort([("is", "尖头 · 一个", "t"), ("不用 is", "我 · 你", None)],
             [("He", 0, "one_is"), ("I", 1, "shape_i"), ("She", 0, "one_is"), ("You", 1, "shape_you"),
              ("It", 0, "one_is"), ("My_dad", 0, "one_is")]),
        pick("My_dad ___ tall .", BE3, "is", zh="我爸爸很高。", wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick("She ___ my friend .", BE3, "is", zh="她是我的朋友。", links=False, wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick("I ___ a boy .", BE3, "am", zh="我是男孩。", links=False, wrong={"are": "shape_i", "is": "shape_i"}),
        fix("She am a girl .", "be", ["is", "are"], "is", wrong={"are": "shape_s3"}),
        order("It is a cat .", zh="它是一只猫。"),
    ],
    pool=[
        pick("He ___ a student .", BE3, "is", zh="他是学生。", links=False, wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick("It ___ big .", BE3, "is", zh="它很大。", links=False, wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick("Amy ___ a girl .", BE3, "is", zh="Amy 是女孩。", links=False, wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick("You ___ tall .", BE3, "are", zh="你很高。", links=False, wrong={"am": "shape_you", "is": "shape_you"}),
        pick("The_cat ___ small .", BE3, "is", zh="这只猫很小。", links=False, wrong={"am": "shape_s3", "are": "shape_s3"}),
        fix("He are my friend .", "be", ["is", "am"], "is", wrong={"am": "shape_s3"}),
        fix("It am a dog .", "be", ["is", "are"], "is", wrong={"are": "shape_s3"}),
        order("She is my teacher .", zh="她是我的老师。"),
        order("He is tall .", zh="他很高。"),
    ],
    misc={
        "shape_s3": "他、她、它,一个,后面用 {is}。尖头配尖口。",
        "one_is": "这是一个人、一个东西,是尖头的,用 {is}。",
        "shape_i": "说自己 {I},后面用 {am},不用 {is}。",
        "shape_you": "说你 {You},后面用 {are},不用 {is}。",
    },
    rule=["He is tall .", "She is tall .", "It is big ."], rule_say="他、她、它,一个,用 {is}。",
)

L103 = lesson(
    103, "我们 · 他们", "We are · They are", "好几个,用 are",
    steps=[
        watch(
            F("我和别人一起,叫 {We}。{We are friends.}", "We are friends .", scene="👧👦", hl=["we"]),
            F("他们好几个,叫 {They}。{They are students.}", "They are students .", scene="👦👦👧", hl=["they"]),
            F("好几个,都是方头的。方头配方口的 {are}。", "We are friends .", "They are students .", hl=["be"]),
            F("一只猫,用 {is}。{The cat is small.}", "The_cat#cat is small .", scene="🐱", hl=["be"]),
            F("两只猫,后面多了一个 {s},就用 {are}。{The cats are small.}", "The_cat|s#cat are small .", scene="🐱🐱",
              hl=["be", "cat"]),
        ),
        tap(["The_dog#dog is big .", "The_dog|s#dog are big ."], "be",
            prompt="狗变成了两只。后面哪一块也跟着变了?点一下。", hint="看第二排蓝色的那一块。"),
        pick("They ___ happy .", BE3, "are", zh="他们很开心。", scene="😊😊", wrong={"am": "shape_pl", "is": "shape_pl"}),
        pick("Amy_and_Mike ___ friends .", BE3, "are", zh="Amy 和 Mike 是朋友。", scene="👧👦",
             wrong={"am": "shape_pl", "is": "shape_pl"}),
        watch(F("记住: 一个,用 {is}。好几个,用 {are}。", "He is happy .", "They are happy .", hl=["be"])),
    ],
    practice=[
        sort([("is", "一个", "t"), ("are", "好几个", "s")],
             [("He", 0, "one_is"), ("They", 1, "many_are"), ("The_dogs", 1, "many_are"), ("My_dad", 0, "one_is"),
              ("We", 1, "many_are"), ("Amy_and_Mike", 1, "many_are")]),
        pick("We ___ students .", BE3, "are", zh="我们是学生。", wrong={"am": "shape_pl", "is": "shape_pl"}),
        pick("The_birds ___ small .", BE3, "are", zh="这些鸟很小。", links=False, wrong={"am": "shape_pl", "is": "shape_pl"}),
        pick("My_friend ___ tall .", BE3, "is", zh="我的朋友很高。", links=False, wrong={"am": "shape_s3", "are": "shape_s3"}),
        fix("They is my friends .", "be", ["are", "am"], "are", wrong={"am": "shape_pl"}),
        order("We are good friends .", zh="我们是好朋友。"),
    ],
    pool=[
        pick("They ___ tall .", BE3, "are", zh="他们很高。", links=False, wrong={"am": "shape_pl", "is": "shape_pl"}),
        pick("The_boys ___ happy .", BE3, "are", zh="男孩们很开心。", links=False, wrong={"am": "shape_pl", "is": "shape_pl"}),
        pick("Tom_and_Lily ___ students .", BE3, "are", zh="Tom 和 Lily 是学生。", links=False,
             wrong={"am": "shape_pl", "is": "shape_pl"}),
        pick("The_girl ___ happy .", BE3, "is", zh="这个女孩很开心。", links=False, wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick("I ___ happy .", BE3, "am", zh="我很开心。", links=False, wrong={"are": "shape_i", "is": "shape_i"}),
        pick("My_friends ___ good .", BE3, "are", zh="我的朋友们很好。", links=False, wrong={"am": "shape_pl", "is": "shape_pl"}),
        fix("We is friends .", "be", ["are", "am"], "are", wrong={"am": "shape_pl"}),
        fix("The_cats is small .", "be", ["are", "am"], "are", wrong={"am": "shape_pl"}),
        order("They are my friends .", zh="他们是我的朋友。"),
        order("The_dogs are big .", zh="这些狗很大。"),
    ],
    misc={
        "shape_pl": "好几个,后面用 {are}。方头配方口。",
        "shape_s3": "一个人、一个东西,后面用 {is}。",
        "shape_i": "说自己 {I},后面用 {am}。",
        "one_is": "这是一个,用 {is}。",
        "many_are": "这是好几个,用 {are}。",
    },
    rule=["He is happy .", "They are happy ."], rule_say="一个,用 {is}。好几个,用 {are}。",
)

NEG2 = ["isn't", "aren't"]

L104 = lesson(
    104, "不是", "is not · are not", "not 住在 am is are 的后面",
    steps=[
        watch(
            F("{He is happy.} 他很开心。", "He is happy .", scene="😊"),
            F("想说「不」,请来一块 {not}。{not} 住在 {is} 的后面。{He is not happy.}", "He is not happy .", scene="😢",
              hl=["not"]),
            F("{am}、{are} 也一样,{not} 住在后面。{I am not tall.} {They are not cats.}",
              "I am not tall .", "They are not cats .", hl=["not"]),
            F("{is} 和 {not} 可以抱在一起,变成 {isn't}。{are} 和 {not},变成 {aren't}。",
              "He isn't happy .", "They aren't cats .", hl=["be"]),
            F("只有 {am} 不抱,还是 {am not}。", "I am not tall .", hl=["be", "not"]),
        ),
        gap("She is a_teacher .", "not", after_block="be", zh="她不是老师。",
            prompt="把 {not} 放进去,说「她不是老师」。点一下空隙。", hint="{not} 住在 {is} 的后面。"),
        gap("They are my_friends/o .", "not", after_block="be", zh="他们不是我的朋友。",
            prompt="把 {not} 放进去。点一下空隙。", hint="{not} 住在 {are} 的后面。"),
        pick("It ___ a dog .", NEG2, "isn't", zh="它不是狗。", scene="🐱", wrong={"aren't": "neg_s3"}),
        watch(F("记住: {not} 住在 {am, is, are} 的后面。", "I am not tall .", "He isn't tall .", "They aren't tall .",
                hl=["be", "not"])),
    ],
    practice=[
        gap("I am a_teacher .", "not", after_block="be", zh="我不是老师。", hint="{not} 住在 {am} 的后面。"),
        pick("They ___ students .", NEG2, "aren't", zh="他们不是学生。", wrong={"isn't": "neg_pl"}),
        pick("My_mum ___ tall .", NEG2, "isn't", zh="我妈妈不高。", links=False, wrong={"aren't": "neg_s3"}),
        hear("She isn't happy .", [("👧😢", "她不开心"), ("👧😊", "她很开心")]),
        order("It is not a_cat .", zh="它不是猫。"),
        fix("He aren't tall .", "be", ["isn't", "are"], "isn't", wrong={"are": "neg_s3"}),
    ],
    pool=[
        gap("He is my_friend/o .", "not", after_block="be", zh="他不是我的朋友。", links=False, hint="{not} 住在 {is} 的后面。"),
        gap("We are tall .", "not", after_block="be", zh="我们不高。", links=False, hint="{not} 住在 {are} 的后面。"),
        pick("The_cat ___ big .", NEG2, "isn't", zh="这只猫不大。", links=False, wrong={"aren't": "neg_s3"}),
        pick("We ___ boys .", NEG2, "aren't", zh="我们不是男孩。", links=False, wrong={"isn't": "neg_pl"}),
        pick("She ___ a student .", NEG2, "isn't", zh="她不是学生。", links=False, wrong={"aren't": "neg_s3"}),
        pick("My_friends ___ happy .", NEG2, "aren't", zh="我的朋友们不开心。", links=False, wrong={"isn't": "neg_pl"}),
        order("I am not tall .", zh="我不高。"),
        order("They are not my_friends/o .", zh="他们不是我的朋友。"),
        fix("They isn't happy .", "be", ["aren't", "is"], "aren't", wrong={"is": "neg_pl"}),
    ],
    misc={
        "neg_s3": "一个人、一个东西,用 {isn't}。",
        "neg_pl": "好几个,用 {aren't}。",
    },
    rule=["I am not tall .", "He isn't tall .", "They aren't tall ."], rule_say="{not} 住在 {am, is, are} 的后面。",
)

L105 = lesson(
    105, "问一问(是不是)", "Is he …? · Are you …?", "把 am is are 搬到最前面",
    steps=[
        watch(
            F("{He is happy.} 他很开心。", "He is happy .", scene="😊"),
            F("想问「他开心吗」,把 {is} 搬到最前面,句号换成问号。{Is he happy?}", "Is he happy ?", scene="🤔", hl=["be"]),
            F("{They are friends.}", "They are friends .", scene="👦👧"),
            F("{are} 也一样,搬到最前面。{Are they friends?}", "Are they friends ?", scene="🤔", hl=["be"]),
            F("回答很短。是: {Yes, he is.} 不是: {No, he isn't.}", "Is he happy ?", "Yes , he is .", "No , he isn't ."),
        ),
        tap("She is a_teacher .", "be", ask="front", after=["Is she a_teacher ?"], hint="搬的是 {is} 这一块。"),
        tap("They are students .", "be", ask="front", after=["Are they students ?"], hint="搬的是 {are} 这一块。"),
        pick("___ you happy ?", ["Is", "Are", "Am"], "Are", zh="你开心吗?", wrong={"Is": "q_pl", "Am": "q_pl"}),
        watch(F("问 {Are you},回答说自己,用 {I am}。{Are you Mike?} {Yes, I am.}", "Are you Mike ?", "Yes , I am .",
                hl=["be"])),
    ],
    practice=[
        tap("It is a_cat .", "be", ask="front", after=["Is it a_cat ?"], hint="搬的是 {is} 这一块。"),
        pick("___ she your_friend ?", ["Is", "Are"], "Is", zh="她是你的朋友吗?", wrong={"Are": "q_s3"}),
        pick("___ they happy ?", ["Is", "Are"], "Are", zh="他们开心吗?", links=False, wrong={"Is": "q_pl"}),
        pick(["Is he tall ?", "Yes , he ___ ."], BE3, "is", zh="他高吗? 是的。", links=False,
             wrong={"am": "shape_s3", "are": "shape_s3"}),
        pick(["Are you a_student ?", "Yes , I ___ ."], BE3, "am", zh="你是学生吗? 是的。", links=False,
             wrong={"are": "ans_i", "is": "ans_i"}),
        order("Is it a_dog ?", zh="它是狗吗?"),
    ],
    pool=[
        tap("He is tall .", "be", ask="front", after=["Is he tall ?"], links=False, hint="搬的是 {is} 这一块。"),
        tap("They are friends .", "be", ask="front", after=["Are they friends ?"], links=False, hint="搬的是 {are} 这一块。"),
        pick("___ it a_bird ?", ["Is", "Are"], "Is", zh="它是鸟吗?", links=False, wrong={"Are": "q_s3"}),
        pick("___ you Amy ?", ["Is", "Are"], "Are", zh="你是 Amy 吗?", links=False, wrong={"Is": "q_pl"}),
        pick("___ the_cats small ?", ["Is", "Are"], "Are", zh="这些猫小吗?", links=False, wrong={"Is": "q_pl"}),
        pick(["Is she happy ?", "No , she ___ ."], NEG2, "isn't", zh="她开心吗? 不。", links=False, wrong={"aren't": "neg_s3"}),
        pick(["Are they students ?", "Yes , they ___ ."], BE3, "are", zh="他们是学生吗? 是的。", links=False,
             wrong={"is": "shape_pl", "am": "shape_pl"}),
        order("Are you happy ?", zh="你开心吗?"),
        order("Is he your_friend ?", zh="他是你的朋友吗?"),
    ],
    misc={
        "q_s3": "问一个人、一个东西,用 {Is}。",
        "q_pl": "问你、问好几个,用 {Are}。",
        "ans_i": "回答说自己,用 {I am}。",
        "shape_s3": "他、她、它,用 {is}。",
        "shape_pl": "好几个,用 {are}。",
        "neg_s3": "一个人、一个东西,用 {isn't}。",
    },
    rule=["He is happy .", "Is he happy ?"], rule_say="想问一问,把 {am, is, are} 搬到最前面。",
)

BE_OR_DO = [("是", "am · is · are", None), ("做", "动作词", None)]

L106 = lesson(
    106, "是 还是 做", "am is are · like play", "有了动作词,就不要 am is are",
    steps=[
        watch(
            F("有的句子说「是什么样」,用 {am, is, are}。{I am happy.}", "I am happy .", scene="😊", hl=["be"]),
            F("有的句子说「做什么」,用动作词。{I like apples.}", "I like apples .", scene="🍎", hl=["like"]),
            F("{play}、{eat}、{read},都是动作词。{I play football.} {I eat fish.}", "I play football .", "I eat fish .",
              hl=["play", "eat"]),
            F("蓝色的位置只有一个。有了动作词,就不要 {am} 了。", "I like apples .", scene="🍎", hl=["like"]),
        ),
        sort(BE_OR_DO, [("like", 1), ("is", 0), ("play", 1), ("are", 0), ("eat", 1), ("am", 0)],
             prompt="它是说「是」的,还是说「做」的?"),
        tap("I am like apples .", "be", ask="extra", after=["I like apples ."], links=False,
            hint="说「喜欢」已经有 {like} 了。多的是另一块蓝色的。"),
        pick("I ___ football .", ["play", "am"], "play", zh="我踢足球。", scene="⚽", links=False, wrong={"am": "need_verb"}),
        pick("They ___ happy .", ["are", "like"], "are", zh="他们很开心。", scene="😊😊", links=False, wrong={"like": "need_be"}),
        watch(F("记住: 说「是」用 {am, is, are},说「做」用动作词。两个不挤在一起。", "I am happy .", "I like apples .",
                hl=["be", "like"])),
    ],
    practice=[
        sort(BE_OR_DO, [("go", 1), ("am", 0), ("read", 1), ("is", 0), ("drink", 1), ("are", 0)],
             prompt="它是说「是」的,还是说「做」的?"),
        tap("We are play football .", "be", ask="extra", after=["We play football ."], links=False,
            hint="已经有 {play} 了。多的是另一块蓝色的。"),
        tap("You are like milk .", "be", ask="extra", after=["You like milk ."], links=False,
            hint="已经有 {like} 了。多的是另一块蓝色的。"),
        pick("I ___ a_student .", ["am", "like"], "am", zh="我是学生。", links=False, wrong={"like": "need_be"}),
        pick("We ___ fish .", ["eat", "are"], "eat", zh="我们吃鱼。", scene="🐟", links=False, wrong={"are": "need_verb"}),
        order("I like my_school .", extra=["am"], wrong_extra="be_plus_verb", zh="我喜欢我的学校。"),
    ],
    pool=[
        tap("I am read books .", "be", ask="extra", after=["I read books ."], links=False,
            hint="已经有 {read} 了。多的是另一块蓝色的。"),
        tap("They are go to_school/p .", "be", ask="extra", after=["They go to_school/p ."], links=False,
            hint="已经有 {go} 了。多的是另一块蓝色的。"),
        pick("You ___ tall .", ["are", "like"], "are", zh="你很高。", links=False, wrong={"like": "need_be"}),
        pick("I ___ milk .", ["drink", "am"], "drink", zh="我喝牛奶。", links=False, wrong={"am": "need_verb"}),
        pick("They ___ football .", ["play", "are"], "play", zh="他们踢足球。", links=False, wrong={"are": "need_verb"}),
        pick("We ___ friends .", ["are", "like"], "are", zh="我们是朋友。", links=False, wrong={"like": "need_be"}),
        order("We play football .", extra=["are"], wrong_extra="be_plus_verb", zh="我们踢足球。"),
        order("I am happy .", extra=["like"], wrong_extra="be_plus_verb", zh="我很开心。"),
        sort(BE_OR_DO, [("watch", 1), ("are", 0), ("have", 1), ("is", 0)], prompt="它是说「是」的,还是说「做」的?"),
    ],
    misc={
        "be_plus_verb": "有了动作词,就不要 {am, is, are} 了。蓝色的位置只有一个。",
        "need_be": "这句说的是「是什么样」,用 {am, is, are}。",
        "need_verb": "这句说的是「做什么」,要用动作词。",
    },
    rule=["I am happy .", "I like apples ."], rule_say="说「是」用 {am, is, are},说「做」用动作词。两个不挤在一起。",
)

S_OR_NOT = [("加 s", "他 · 她 · 它 · 一个", "t"), ("不加", "我 · 你 · 好几个", None)]

L107 = lesson(
    107, "他她它 做什么", "He likes · She plays", "他、她、它,动作词长一条尾巴 s",
    steps=[
        watch(
            F("{I like apples.} 我喜欢苹果。", "I like apples .", scene="🙋🍎"),
            F("换成 {He}。{He} 是尖头的,动作词要长出一条小尾巴 {s},才接得上。{He likes apples.}", "He likes apples .",
              scene="👦🍎", hl=["like"]),
            F("{She plays football.} {It eats fish.} 他、她、它,一个,动作词都带 {s}。", "She plays football .",
              "It eats fish .", hl=["play", "eat"]),
            F("我、你、好几个,不长尾巴。{They like apples.}", "They like apples .", scene="👦👧🍎", hl=["like"]),
        ),
        tap(["I like milk .", "She likes milk ."], "like",
            prompt="{I} 换成了 {She}。后面哪一块也跟着变了?点一下。", hint="看第二排蓝色的那一块。"),
        pick("He ___ football .", ["play", "plays"], "plays", zh="他踢足球。", scene="👦⚽", wrong={"play": "no_s"}),
        pick("They ___ fish .", ["eat", "eats"], "eat", zh="他们吃鱼。", scene="👦👧🐟", wrong={"eats": "extra_s"}),
        watch(F("记住: 他、她、它,一个,动作词加 {s}。尖头配尖口。", "I like milk .", "He likes milk .", hl=["like"])),
    ],
    practice=[
        sort(S_OR_NOT, [("My_mum", 0, "one_s"), ("I", 1, "not_s"), ("The_dogs", 1, "not_s"), ("She", 0, "one_s"),
                        ("You", 1, "not_s"), ("Mike", 0, "one_s")],
             prompt="它后面的动作词,要不要加 {s}?"),
        pick("My_dad ___ books .", ["read", "reads"], "reads", zh="我爸爸读书。", wrong={"read": "no_s"}),
        pick("We ___ football .", ["play", "plays"], "play", zh="我们踢足球。", links=False, wrong={"plays": "extra_s"}),
        pick("Amy ___ milk .", ["drink", "drinks"], "drinks", zh="Amy 喝牛奶。", links=False, wrong={"drink": "no_s"}),
        fix("She like apples .", "like", ["likes", "is"], "likes", wrong={"is": "be_plus_verb"}),
        order("He reads books .", extra=["read"], wrong_extra="no_s", zh="他读书。"),
    ],
    pool=[
        pick("She ___ fish .", ["eat", "eats"], "eats", zh="她吃鱼。", links=False, wrong={"eat": "no_s"}),
        pick("I ___ apples .", ["like", "likes"], "like", zh="我喜欢苹果。", links=False, wrong={"likes": "extra_s"}),
        pick("The_cat ___ milk .", ["drink", "drinks"], "drinks", zh="这只猫喝牛奶。", links=False, wrong={"drink": "no_s"}),
        pick("They ___ books .", ["read", "reads"], "read", zh="他们读书。", links=False, wrong={"reads": "extra_s"}),
        pick("My_friend ___ football .", ["play", "plays"], "plays", zh="我的朋友踢足球。", links=False, wrong={"play": "no_s"}),
        pick("You ___ milk .", ["like", "likes"], "like", zh="你喜欢牛奶。", links=False, wrong={"likes": "extra_s"}),
        fix("He play football .", "play", ["plays", "is"], "plays", wrong={"is": "be_plus_verb"}),
        fix("They likes apples .", "like", ["like", "are"], "like", wrong={"are": "be_plus_verb"}),
        order("She likes my_dog/o .", extra=["like"], wrong_extra="no_s", zh="她喜欢我的狗。"),
        order("We like fish .", extra=["likes"], wrong_extra="extra_s", zh="我们喜欢鱼。"),
    ],
    misc={
        "no_s": "一个人、一个东西,不是我也不是你,动作词要加 {s}。",
        "extra_s": "我、你、好几个,动作词不加 {s}。",
        "one_s": "这是一个人、一个东西,是尖头的,动作词要加 {s}。",
        "not_s": "我、你、好几个,动作词不加 {s}。",
        "be_plus_verb": "有了动作词,就不要 {am, is, are} 了。",
    },
    rule=["I like milk .", "He likes milk ."], rule_say="他、她、它,一个,动作词加 {s}。",
)

S_OR_ES = [("+ s", "大多数", None), ("+ es", "o · sh · ch 结尾", None)]

L108 = lesson(
    108, "尾巴的样子", "likes · goes · studies · has", "尾巴有 s、es、ies 三种,have 变 has",
    steps=[
        watch(
            F("大多数动作词,尾巴就是一个 {s}。{likes, plays, eats.}", "He likes fish .", "She plays football .",
              hl=["like", "play"]),
            F("结尾是 {o|O}、{sh|S, H}、{ch|C, H} 的,尾巴是 {es|E, S}。{go, goes.} {wash, washes.} {watch, watches.}",
              "He goes to_school/p .", "She watches TV .", hl=["go", "watch"]),
            F("结尾是 {y|Y},前面不是 {a e i o u|A, E, I, O, U}: 把 {y|Y} 换成 {i|I},再加 {es|E, S}。{study, studies.}",
              "She studies English .", hl=["study"]),
            F("{play} 的 {y|Y} 前面是 {a|A},不用换,直接加 {s}。{plays.}", "He plays football .", hl=["play"]),
            F("{have} 最特别,变成 {has}。{He has a dog.}", "He has a_dog .", scene="🐶", hl=["have"]),
        ),
        sort(S_OR_ES, [("like", 0), ("go", 1, "es_form"), ("watch", 1, "es_form"), ("eat", 0), ("wash", 1, "es_form"),
                       ("read", 0)], prompt="这个动作词的尾巴,是 {s} 还是 {es|E, S}?"),
        pick("She ___ English .", ["studys", "studies", "studyes"], "studies", zh="她学英语。", links=False,
             prompt="{study} 加上尾巴,是哪一个?", wrong={"studys": "y_form", "studyes": "y_form"}),
        pick("He ___ a_cat .", ["haves", "has", "have"], "has", zh="他有一只猫。", scene="🐱", links=False,
             prompt="{have} 加上尾巴,是哪一个?", wrong={"haves": "has_form", "have": "no_s"}),
        watch(F("记住: 一般加 {s};{o|O}、{sh|S, H}、{ch|C, H} 结尾加 {es|E, S};{y|Y} 换成 {ies|I, E, S};{have} 变 {has}。",
                "She likes fish .", "She goes home/p .", "She studies English .", "She has a_cat .",
                hl=["like", "go", "study", "have"])),
    ],
    practice=[
        sort(S_OR_ES, [("play", 0), ("wash", 1, "es_form"), ("drink", 0), ("go", 1, "es_form"), ("watch", 1, "es_form"),
                       ("sing", 0)], prompt="这个动作词的尾巴,是 {s} 还是 {es|E, S}?"),
        pick("He ___ to_school/p .", ["gos", "goes", "go"], "goes", zh="他去上学。", links=False,
             wrong={"gos": "es_form", "go": "no_s"}),
        pick("My_mum ___ TV .", ["watchs", "watches", "watch"], "watches", zh="我妈妈看电视。", links=False,
             wrong={"watchs": "es_form", "watch": "no_s"}),
        pick("Amy ___ English .", ["studys", "studies", "studyes"], "studies", zh="Amy 学英语。", links=False,
             wrong={"studys": "y_form", "studyes": "y_form"}),
        pick("She ___ football .", ["plaies", "plays", "play"], "plays", zh="她踢足球。", links=False,
             wrong={"plaies": "vowel_y", "play": "no_s"}),
        fix("He haves/d a_dog .", "haves", ["has", "have"], "has", wrong={"have": "no_s"}, hint="看看「有」那一块,尾巴对不对。"),
    ],
    pool=[
        pick("My_dad ___ a_dog .", ["haves", "has", "have"], "has", zh="我爸爸有一只狗。", links=False,
             wrong={"haves": "has_form", "have": "no_s"}),
        pick("The_bird ___ .", ["flys", "flies", "flyes"], "flies", zh="这只鸟会飞。", links=False,
             wrong={"flys": "y_form", "flyes": "y_form"}),
        pick("Mike ___ TV .", ["watchs", "watches"], "watches", zh="Mike 看电视。", links=False, wrong={"watchs": "es_form"}),
        pick("She ___ home/p .", ["gos", "goes"], "goes", zh="她回家。", links=False, wrong={"gos": "es_form"}),
        pick("It ___ milk .", ["drinks", "drinkes"], "drinks", zh="它喝牛奶。", links=False, wrong={"drinkes": "plain_s"}),
        pick("He ___ English .", ["studys", "studies"], "studies", zh="他学英语。", links=False, wrong={"studys": "y_form"}),
        pick("Amy ___ the_dog/o .", ["washs", "washes"], "washes", zh="Amy 给狗洗澡。", links=False, wrong={"washs": "es_form"}),
        fix("She gos/d to_school/p .", "gos", ["goes", "go"], "goes", wrong={"go": "no_s"}, hint="看看「去」那一块,尾巴对不对。"),
        fix("Mike studys/d English .", "studys", ["studies", "study"], "studies", wrong={"study": "no_s"},
            hint="看看「学」那一块,尾巴对不对。"),
    ],
    misc={
        "es_form": "结尾是 {o|O}、{sh|S, H}、{ch|C, H} 的,尾巴是 {es|E, S}。",
        "y_form": "{y|Y} 前面不是 {a e i o u|A, E, I, O, U},把 {y|Y} 换成 {i|I},再加 {es|E, S}。",
        "vowel_y": "{y|Y} 前面是 {a|A},不用换,直接加 {s}。",
        "has_form": "{have} 最特别,变成 {has}。",
        "plain_s": "这个词直接加 {s} 就行。",
        "no_s": "他、她、它,一个,动作词要带尾巴。",
    },
    rule=["She likes fish .", "She goes home/p .", "She studies English .", "She has a_cat ."],
    rule_say="一般加 {s};{o|O}、{sh|S, H}、{ch|C, H} 结尾加 {es|E, S};{y|Y} 换成 {ies|I, E, S};{have} 变 {has}。",
)

DONT2 = ["don't", "doesn't"]

L109 = lesson(
    109, "不做", "don't · doesn't", "动作词说「不」,请小帮手 do",
    steps=[
        watch(
            F("{I like milk.} 我喜欢牛奶。", "I like milk .", scene="🥛😊"),
            F("动作词想说「不」,不能直接放 {not}。先请小帮手 {do}。{do} 和 {not} 抱在一起,就是 {don't}。",
              "I don't like milk .", scene="🥛😖", hl=["do"]),
            F("{don't} 站在动作词的前面。{I don't like milk.}", "I don't like milk .", scene="🥛😖", hl=["do", "like"]),
            F("{He likes milk.} 他是尖头的,动作词带着尾巴。", "He likes milk .", scene="👦🥛", hl=["like"]),
            F("小帮手来了,把尾巴接走,自己变成 {does}。{like} 的尾巴就没了。{He doesn't like milk.}",
              "He doesn't like milk .", scene="👦🥛😖", hl=["do", "like"]),
        ),
        gap("We play football .", "don't", before="play", zh="我们不踢足球。",
            prompt="把 {don't} 放进去,说「我们不踢足球」。点一下空隙。", hint="{don't} 站在动作词的前面。"),
        pick("She ___/h like fish .", DONT2, "doesn't", zh="她不喜欢鱼。", scene="👧🐟", wrong={"don't": "dont_s3"}),
        pick("He doesn't ___ fish .", ["like", "likes"], "like", zh="他不喜欢鱼。", scene="👦🐟", wrong={"likes": "double_s"}),
        watch(F("记住: 我、你、好几个,用 {don't}。他、她、它,用 {doesn't}。后面的动作词不带尾巴。",
                "I don't like fish .", "He doesn't like fish .", hl=["do"])),
    ],
    practice=[
        gap("I like fish .", "don't", before="like", zh="我不喜欢鱼。", hint="{don't} 站在动作词的前面。"),
        pick("My_dad ___/h watch TV .", DONT2, "doesn't", zh="我爸爸不看电视。", wrong={"don't": "dont_s3"}),
        pick("They ___/h play football .", DONT2, "don't", zh="他们不踢足球。", links=False, wrong={"doesn't": "doesnt_pl"}),
        pick("She doesn't ___ milk .", ["drink", "drinks"], "drink", zh="她不喝牛奶。", links=False, wrong={"drinks": "double_s"}),
        fix("He doesn't likes apples .", "like", ["like", "is"], "like", wrong={"is": "need_do"},
            hint="看看 {doesn't} 后面那一块,还带着尾巴吗?"),
        pick("He ___/h happy .", ["isn't", "doesn't"], "isn't", zh="他不开心。", links=False, wrong={"doesn't": "need_be"}),
    ],
    pool=[
        pick("Amy ___/h like milk .", DONT2, "doesn't", zh="Amy 不喜欢牛奶。", links=False, wrong={"don't": "dont_s3"}),
        pick("We ___/h like fish .", DONT2, "don't", zh="我们不喜欢鱼。", links=False, wrong={"doesn't": "doesnt_pl"}),
        pick("The_cat ___/h eat apples .", DONT2, "doesn't", zh="这只猫不吃苹果。", links=False, wrong={"don't": "dont_s3"}),
        pick("I ___/h watch TV .", DONT2, "don't", zh="我不看电视。", links=False, wrong={"doesn't": "doesnt_pl"}),
        pick("My_mum doesn't ___ TV .", ["watch", "watches"], "watch", zh="我妈妈不看电视。", links=False,
             wrong={"watches": "double_s"}),
        pick("He ___/h tall .", ["isn't", "doesn't"], "isn't", zh="他不高。", links=False, wrong={"doesn't": "need_be"}),
        pick("She ___/h play football .", ["isn't", "doesn't"], "doesn't", zh="她不踢足球。", links=False,
             wrong={"isn't": "need_do"}),
        fix("She don't like fish .", "do", ["doesn't", "isn't"], "doesn't", wrong={"isn't": "need_do"},
            hint="看看「不」那一块,和 {She} 对不对得上。"),
        fix("They doesn't play football .", "do", ["don't", "aren't"], "don't", wrong={"aren't": "need_do"},
            hint="看看「不」那一块,和 {They} 对不对得上。"),
        order("I don't like milk .", zh="我不喜欢牛奶。"),
        order("He doesn't eat fish .", extra=["eats"], wrong_extra="double_s", zh="他不吃鱼。"),
    ],
    misc={
        "dont_s3": "他、她、它,一个,小帮手用 {doesn't}。",
        "doesnt_pl": "我、你、好几个,小帮手用 {don't}。",
        "double_s": "尾巴已经被 {does} 接走了,后面的动作词不带 {s}。",
        "need_be": "这句没有动作词,说的是「是什么样」,用 {isn't}。",
        "need_do": "这句有动作词,要请小帮手 {do}。",
    },
    rule=["I don't like fish .", "He doesn't like fish ."],
    rule_say="我、你、好几个,用 {don't}。他、她、它,用 {doesn't}。后面的动作词不带尾巴。",
)

DO2 = ["Do", "Does"]

L110 = lesson(
    110, "问一问(做不做)", "Do you …? · Does he …?", "动作词的句子,请小帮手 Do / Does 站到最前面",
    steps=[
        watch(
            F("{You like apples.} 你喜欢苹果。", "You like apples .", scene="🍎"),
            F("动作词的句子要问一问,动作词不搬家。请小帮手 {Do} 站到最前面。{Do you like apples?}",
              "Do you like apples ?", scene="🍎🤔", hl=["do"]),
            F("{He likes apples.} 他是尖头的。", "He likes apples .", scene="👦🍎", hl=["like"]),
            F("小帮手把尾巴接走,变成 {Does},站到最前面。{Does he like apples?}", "Does he like apples ?",
              scene="👦🍎🤔", hl=["do", "like"]),
            F("回答很短。{Yes, I do.} {No, I don't.} {Yes, he does.} {No, he doesn't.}",
              "Do you like apples ?", "Yes , I do .", "Does he like apples ?", "No , he doesn't ."),
        ),
        pick("___/h she play football ?", DO2, "Does", zh="她踢足球吗?", scene="👧⚽", wrong={"Do": "do_s3"}),
        pick("Does he ___ fish ?", ["like", "likes"], "like", zh="他喜欢鱼吗?", scene="👦🐟", wrong={"likes": "double_s"}),
        pick("___/h they like milk ?", DO2, "Do", zh="他们喜欢牛奶吗?", scene="👦👧🥛", wrong={"Does": "do_pl"}),
        watch(F("记住: 问我、你、好几个,用 {Do}。问他、她、它,用 {Does}。后面的动作词不带尾巴。",
                "Do you like fish ?", "Does she like fish ?", hl=["do"])),
    ],
    practice=[
        pick("___/h Amy like apples ?", DO2, "Does", zh="Amy 喜欢苹果吗?", wrong={"Do": "do_s3"}),
        pick("___/h you play football ?", DO2, "Do", zh="你踢足球吗?", links=False, wrong={"Does": "do_pl"}),
        pick("Does she ___ TV ?", ["watch", "watches"], "watch", zh="她看电视吗?", links=False, wrong={"watches": "double_s"}),
        pick(["Does he like milk ?", "Yes , he ___/h ."], ["does", "do", "is"], "does", zh="他喜欢牛奶吗? 是的。", links=False,
             wrong={"do": "ans_do", "is": "ans_do"}),
        pick("___/h he happy ?", ["Is", "Does"], "Is", zh="他开心吗?", links=False, wrong={"Does": "need_be_q"}),
        order("Do you like milk ?", extra=["Does"], wrong_extra="do_pl", zh="你喜欢牛奶吗?"),
    ],
    pool=[
        pick("___/h they read books ?", DO2, "Do", zh="他们读书吗?", links=False, wrong={"Does": "do_pl"}),
        pick("___/h the_cat like fish ?", DO2, "Does", zh="这只猫喜欢鱼吗?", links=False, wrong={"Do": "do_s3"}),
        pick("Do they ___ football ?", ["play", "plays"], "play", zh="他们踢足球吗?", links=False, wrong={"plays": "double_s"}),
        pick("Does Amy ___ apples ?", ["like", "likes"], "like", zh="Amy 喜欢苹果吗?", links=False, wrong={"likes": "double_s"}),
        pick(["Do you like fish ?", "No , I ___/h ."], ["don't", "doesn't"], "don't", zh="你喜欢鱼吗? 不。", links=False,
             wrong={"doesn't": "ans_do"}),
        pick(["Does she play football ?", "No , she ___/h ."], ["doesn't", "don't", "isn't"], "doesn't",
             zh="她踢足球吗? 不。", links=False, wrong={"don't": "ans_do", "isn't": "ans_do"}),
        pick("___/h she like milk ?", ["Is", "Does"], "Does", zh="她喜欢牛奶吗?", links=False, wrong={"Is": "need_do_q"}),
        pick("___/h they friends ?", ["Are", "Do"], "Are", zh="他们是朋友吗?", links=False, wrong={"Do": "need_be_q"}),
        fix("Does he likes fish ?", "like", ["like", "is"], "like", wrong={"is": "need_do_q"},
            hint="看看 {Does} 后面的动作词,还带着尾巴吗?"),
        fix("Do she play football ?", "do", ["Does", "Is"], "Does", wrong={"Is": "need_do_q"},
            hint="看看最前面那一块,和 {she} 对不对得上。"),
        order("Does he like fish ?", extra=["likes"], wrong_extra="double_s", zh="他喜欢鱼吗?"),
    ],
    misc={
        "do_s3": "问他、她、它,小帮手用 {Does}。",
        "do_pl": "问我、你、好几个,小帮手用 {Do}。",
        "double_s": "尾巴已经被 {Does} 接走了,后面的动作词不带 {s}。",
        "need_be_q": "这句没有动作词,问的是「是什么样」,用 {Is} 或者 {Are}。",
        "need_do_q": "这句有动作词,要请小帮手 {Do} 或者 {Does}。",
        "ans_do": "用 {Do} 问,用 {do} 答。用 {Does} 问,用 {does} 答。",
    },
    rule=["Do you like fish ?", "Does she like fish ?"],
    rule_say="问我、你、好几个,用 {Do}。问他、她、它,用 {Does}。后面的动作词不带尾巴。",
)

LESSONS = [L101, L102, L103, L104, L105, L106, L107, L108, L109, L110]
