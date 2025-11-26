const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path'); 

const app = express();
const authRouter = express.Router();
const postRouter = express.Router(); // ⭐ Express Router 선언
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your_strong_jwt_secret'; 

// --- 1. 미들웨어 설정 ---
app.use(cors()); 
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// --- 2. MongoDB 연결 ---
// ⭐ DB 비밀번호 'gate2330' 적용
const MONGODB_URI = 'mongodb+srv://vine33411_db_user:gate2330@cluster0.yv7tkak.mongodb.net/?appName=Cluster0';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB 연결 성공!'))
    .catch(err => console.error('MongoDB 연결 실패: ', err));

// --- 3. 스키마 정의 ---
const CommentSchema = new mongoose.Schema({
    text: { type: String, required: true },
    author: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // ✅ 이 댓글이 어떤 게시물에 속해있는지 ID로 연결합니다.
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true }, 
    createdAt: { type: Date, default: Date.now }
});

const PostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    imageData: { type: String, required: true },
    author: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // ❌ 이제 Post는 댓글 데이터를 직접 가지고 있지 않습니다. 이 줄을 삭제하세요.
    // comments: [CommentSchema], 
    createdAt: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function() { 
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
});

const Comment = mongoose.model('Comment', CommentSchema);
const Post = mongoose.model('Post', PostSchema);
const User = mongoose.model('User', UserSchema);

// --- 4. JWT 인증 미들웨어 ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) {
        return res.status(401).json({ message: '로그인이 필요합니다.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: '유효하지 않거나 만료된 토큰입니다.' });
        }
        req.user = user; 
        next();
    
    });
};


// ==========================================================
// 5. 인증 (Auth) API 라우트 (router 사용)
// ==========================================================

// --- 회원가입 라우트 ---
authRouter.post('/register', async (req, res) => { // ⭐ /auth 제거
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ message: '사용자 이름과 비밀번호를 입력해주세요.' });
    }

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(409).json({ message: '이미 존재하는 사용자 이름입니다.' });
        }
        
        const user = new User({ username, password });
        await user.save();
        
        res.status(201).json({ message: '회원가입이 성공적으로 완료되었습니다.' });
    } catch (error) {
        console.error('회원가입 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

// --- 로그인 라우트 ---
authRouter.post('/login', async (req, res) => { // ⭐ /auth 제거
    const { username, password } = req.body;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: '사용자 이름 또는 비밀번호가 올바르지 않습니다.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: '사용자 이름 또는 비밀번호가 올바르지 않습니다.' });
        }

        const token = jwt.sign(
            { id: user._id, username: user.username }, 
            JWT_SECRET, 
            { expiresIn: '1d' }
        );
        
        res.json({ 
            message: '로그인 성공', 
            token: token,
            username: user.username
        });
    } catch (error) {
        console.error('로그인 오류:', error);
        res.status(500).json({ message: '서버 오류가 발생했습니다.' });
    }
});

// ==========================================================
// 6. 게시물 (Post) API 라우트 (router 사용)
// ==========================================================

// --- 게시물 생성 ---
postRouter.post('/posts', authenticateToken, async (req, res) => {  // ⭐ /auth 제거
    const { title, content, imageData } = req.body;
    const author = req.user.username;
    const authorId = req.user.id;

    if (!title || !content || !imageData) {
        return res.status(400).json({ message: '제목, 내용, 그림 데이터가 모두 필요합니다.' });
    }

    try {
        const newPost = new Post({ 
            title, 
            content, 
            imageData, 
            author,
            authorId 
        });
        await newPost.save();
        res.status(201).json(newPost);
    } catch (error) {
        console.error('게시물 생성 오류:', error);
        res.status(500).json({ message: '게시물 생성에 실패했습니다.' });
    }
});

// --- 전체 게시물 조회 및 랭킹 ---
postRouter.get('/posts', authenticateToken, async (req, res) => {
    try {
        const sortType = req.query.sort || 'latest';
        let posts;

        if (sortType === 'comments') {
            // 댓글순 정렬: aggregate 사용
            posts = await Post.aggregate([
                { $addFields: { commentCount: { $size: { "$ifNull": ["$comments", []] } } } },
                { $sort: { commentCount: -1, createdAt: -1 } }
            ]);
        } else {
            // 인기순 또는 최신순 정렬
            const sortOption = sortType === 'popular' ? { likes: -1, createdAt: -1 } : { createdAt: -1 };
            posts = await Post.find().sort(sortOption).lean();
        }
        
        const ranking = await Post.find().sort({ likes: -1, createdAt: -1 }).limit(10).lean();

        const postsWithLikedStatus = posts.map(post => {
            const postObj = { ...post }; 
            // ObjectId 비교를 위해 .some()과 .equals() 사용
            postObj.isLiked = post.likedBy && post.likedBy.some(id => id.equals(req.user.id));
            delete postObj.likedBy; 
            return postObj;
        });

        res.json({ posts: postsWithLikedStatus, ranking });
    } catch (error) {
        console.error('게시물 조회 오류:', error);
        res.status(500).json({ message: '게시물을 불러오는 데 실패했습니다.' });
    }
});

// --- 특정 게시물 상세 조회 ---
postRouter.get('/posts/:id', authenticateToken, async (req, res) => {
    try {
        // 1. 게시물 정보를 찾습니다.
        const post = await Post.findById(req.params.id).lean();
        if (!post) {
            return res.status(404).json({ message: '게시물을 찾을 수 없습니다.' });
        }

        // 2. 이 게시물에 달린 모든 댓글들을 Comment 컬렉션에서 찾습니다.
        const comments = await Comment.find({ postId: req.params.id }).sort({ createdAt: 'asc' });

        // 3. 게시물 정보에 댓글 정보를 추가해서 함께 보내줍니다.
        post.comments = comments;
        post.isLiked = post.likedBy && post.likedBy.some(id => id.equals(req.user.id));
        delete post.likedBy;
        
        res.json(post);
    } catch (error) {
        console.error('게시물 상세 조회 오류:', error);
        res.status(500).json({ message: '게시물 상세 정보를 불러오는 데 실패했습니다.' });
    }
});

// --- 게시물 삭제 ---
postRouter.delete('/posts/:id', authenticateToken, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: '게시물을 찾을 수 없습니다.' });
        }

        if (post.authorId.toString() !== req.user.id) {
            return res.status(403).json({ message: '본인이 작성한 게시물만 삭제할 수 있습니다.' });
        }

        // ✅ 핵심: 이 게시물에 달린 모든 댓글도 함께 삭제합니다.
        await Comment.deleteMany({ postId: req.params.id });
        
        // 그 다음 게시물을 삭제합니다.
        await Post.deleteOne({ _id: req.params.id });

        res.json({ message: '게시물과 관련 댓글이 모두 성공적으로 삭제되었습니다.' });
    } catch (error) {
        console.error('게시물 삭제 오류:', error);
        res.status(500).json({ message: '게시물 삭제에 실패했습니다.' });
    }
});


// ==========================================================
// 7. 좋아요 및 댓글 API 라우트 (router 사용)
// ==========================================================

// --- 좋아요 토글 ---
postRouter.post('/posts/:id/like', authenticateToken, async (req, res) => { // ⭐ /auth 제거
    try {
        const postId = req.params.id;
        const userId = req.user.id;

        const post = await Post.findById(postId);
        if (!post) {
            return res.status(404).json({ message: '게시물을 찾을 수 없습니다.' });
        }

        const likedIndex = post.likedBy.findIndex(id => id.toString() === userId);

        if (likedIndex > -1) {
            post.likedBy.splice(likedIndex, 1);
            post.likes = Math.max(0, post.likes - 1);
            await post.save();
            res.json({ message: '좋아요가 취소되었습니다.', likes: post.likes, isLiked: false }); 
        } else {
            post.likedBy.push(userId);
            post.likes += 1;
            await post.save();
            res.json({ message: '좋아요를 눌렀습니다.', likes: post.likes, isLiked: true });
        }
    } catch (error) {
        console.error('좋아요 토글 오류:', error);
        res.status(500).json({ message: '좋아요 처리 중 오류가 발생했습니다.' });
    }
});


postRouter.get('/users/myposts', authenticateToken, async (req, res) => {
    try {
        // 현재 로그인한 사용자(req.user.id)가 작성한 모든 게시글을 찾아서 최신순으로 정렬합니다.
        const myPosts = await Post.find({ authorId: req.user.id }).sort({ createdAt: -1 });
        // 찾은 게시글 목록을 클라이언트에게 JSON 형태로 응답합니다.
        res.json(myPosts);
    } catch (error) {
        // 오류 발생 시 500 상태 코드와 함께 에러 메시지를 응답합니다.
        res.status(500).json({ message: '내 게시글을 불러오는 중 오류가 발생했습니다.' });
    }
});

// --- 내가 쓴 댓글 목록 조회 ---
postRouter.get('/users/mycomments', authenticateToken, async (req, res) => {
    try {
        // 현재 로그인한 사용자(req.user.id)가 작성한 모든 댓글을 찾습니다.
        const myComments = await Comment.find({ authorId: req.user.id })
            // .populate(): 댓글이 참조하는 postId를 이용해 Post 컬렉션에서 'title' 정보를 가져와 합쳐줍니다.
            .populate('postId', 'title') 
            .sort({ createdAt: -1 }); // 최신순으로 정렬합니다.
        // 찾은 댓글 목록을 클라이언트에게 JSON 형태로 응답합니다.
        res.json(myComments);
    } catch (error) {
        // 오류 발생 시 500 상태 코드와 함께 에러 메시지를 응답합니다.
        res.status(500).json({ message: '내 댓글을 불러오는 중 오류가 발생했습니다.' });
    }
});

// --- 댓글 삭제 ---
postRouter.delete('/comments/:id', authenticateToken, async (req, res) => {
    try {
        // URL 파라미터에서 삭제할 댓글의 ID를 가져옵니다.
        const commentId = req.params.id;
        // 해당 ID를 가진 댓글을 데이터베이스에서 찾습니다.
        const comment = await Comment.findById(commentId);

        // 댓글이 존재하지 않으면 404 에러를 응답합니다.
        if (!comment) {
            return res.status(404).json({ message: '삭제할 댓글을 찾을 수 없습니다.' });
        }

        // 댓글 작성자 ID와 현재 로그인한 사용자 ID가 다르면 403 에러(권한 없음)를 응답합니다.
        if (comment.authorId.toString() !== req.user.id) {
            return res.status(403).json({ message: '본인이 작성한 댓글만 삭제할 수 있습니다.' });
        }

        // 모든 검사를 통과하면 해당 댓글을 삭제합니다.
        await Comment.deleteOne({ _id: commentId });
        // 성공 메시지를 응답합니다.
        res.json({ message: '댓글이 성공적으로 삭제되었습니다.' });
    } catch (error) {
        // 오류 발생 시 500 상태 코드와 함께 에러 메시지를 응답합니다.
        res.status(500).json({ message: '댓글 삭제 중 오류가 발생했습니다.' });
    }
});
// ==========================================================
// ⭐ 8. 라우터 연결 (API 요청을 여기서 먼저 처리합니다.)
// ==========================================================
app.use('/auth', authRouter);
app.use('/', postRouter);

// ==========================================================
// 9. 최종 정적 파일 서빙 (가장 마지막에 위치해야 함)
// ==========================================================
app.use(express.static(__dirname));


// ==========================================================
// 10. 서버 실행
// ==========================================================
app.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`-----------------------------------------------`);
    console.log(`🎨 그림판 링크: http://localhost:${PORT}/index.html`);
    console.log(`💬 커뮤니티 링크: http://localhost:${PORT}/community.html`);
    console.log(`-----------------------------------------------`);
});