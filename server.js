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
    author: { type: String, required: true },
    text: { type: String, required: true },
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
    comments: [CommentSchema],
    createdAt: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }

});

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
postRouter.get('/posts', authenticateToken, async (req, res) => { // ⭐ /auth 제거
    try {
        const posts = await Post.find().sort({ createdAt: -1 }); 
        
        const ranking = await Post.find()
            .sort({ likes: -1, createdAt: -1 })
            .limit(5);

        const postsWithLikedStatus = posts.map(post => {
            const postObj = post.toObject();
            postObj.isLiked = postObj.likedBy.includes(req.user.id);
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
postRouter.get('/posts/:id', authenticateToken, async (req, res) => { // ⭐ /auth 제거
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: '게시물을 찾을 수 없습니다.' });
        }

        const postObj = post.toObject();
        postObj.isLiked = postObj.likedBy.includes(req.user.id);
        delete postObj.likedBy; 
        
        res.json(postObj);
    } catch (error) {
        console.error('게시물 상세 조회 오류:', error);
        res.status(500).json({ message: '게시물 상세 정보를 불러오는 데 실패했습니다.' });
    }
});

// --- 게시물 삭제 ---
postRouter.delete('/posts/:id', authenticateToken, async (req, res) => { // ⭐ /auth 제거
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: '게시물을 찾을 수 없습니다.' });
        }

        if (post.authorId.toString() !== req.user.id) {
            return res.status(403).json({ message: '본인이 작성한 게시물만 삭제할 수 있습니다.' });
        }

        await Post.deleteOne({ _id: req.params.id });
        res.json({ message: '게시물이 성공적으로 삭제되었습니다.' });
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


// --- 댓글 추가 ---
postRouter.post('/posts/:id/comment', authenticateToken, async (req, res) => { // ⭐ /auth 제거
    try {
        const postId = req.params.id;
        const commentText = req.body.commentText;
        const author = req.user.username;

        if (!commentText) {
            return res.status(400).json({ message: '댓글 내용을 입력해주세요.' });
        }

        const newComment = {
            author: author,
            text: commentText
        };

        const post = await Post.findByIdAndUpdate(
            postId,
            { $push: { comments: newComment } },
            { new: true }
        );

        if (!post) {
            return res.status(404).json({ message: '게시물을 찾을 수 없습니다.' });
        }

        res.status(201).json({ message: '댓글이 성공적으로 등록되었습니다.', comments: post.comments });
    } catch (error) {
        console.error('댓글 추가 오류:', error);
        res.status(500).json({ message: '댓글 등록에 실패했습니다.' });
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