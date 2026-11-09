/* 汕头市金山中学 —— 人工整理的建筑/景观标注（可自行修改层数、风格、描述）
 * 键为 OSM 建筑 id（见 campus-data.js）。未列出的建筑按 OSM 类型给默认值。
 * levels：层数；style：立面风格；shape：屋顶形式（hip 四坡 / dome 穹顶 / shell 壳体 / planetarium 天象厅 / pavilion 亭）
 * cat：分类（teach 教学区 / life 生活区 / sport 运动区 / scene 景观 / west 西校区 / around 周边）
 * 层数除 OSM 已标注者外均为依据卫星影像的估计值。
 */
window.CAMPUS_INFO = {
  school: {
    name: '汕头市金山中学',
    address: '广东省汕头市濠江区礐石海关顶41号',
    intro:
      '前身为清光绪三年（1877年）创办于潮州金山的金山书院。1952年迁至汕头礐石，并与礐光中学合并。' +
      '学校位于礐石风景区，依山傍海；占地约10.6万平方米，建筑面积约7.5万平方米（据学校官网简介）。' +
      '2005年毗邻的市警察训练学校划归金中，建成金中西校区；2012年小礐石校区及通向大操场的景观天桥落成。',
  },
  buildings: {
    // ---- 教学区 ----
    '524896183': {
      levels: 4, floorH: 4.2, style: 'glass', shape: 'shell', cat: 'teach',
      shell: { dir: [-1, 1], hMax: 21, hMin: 9.5, pow: 1.35, color: '#f2f1eb' },
      desc: '学校图书馆。据学校简介，馆内现存承继自金山书院的明清古籍 10426 册。白色扇形曲面屋顶是俯瞰校园时最醒目的标志之一。',
    },
    '524896526': { levels: 5, style: 'teaching', cat: 'teach', desc: '高三年级教学楼，位于校园南部，东侧为 A 栋宿舍（一二九楼）。' },
    '527044092': { levels: 6, style: 'teaching', cat: 'teach', desc: '高二年级教学楼（OSM 标注 6 层），东南侧为七一广场。' },
    '527044105': { levels: 7, style: 'teaching', cat: 'teach', desc: '高一年级教学楼（OSM 标注 7 层），带内庭院，东侧为篮球场与体艺馆。' },
    '527044104': { levels: 5, style: 'lab', cat: 'teach', desc: '实验楼。东侧紧邻银色穹顶的天象厅；斯忠地质博物馆亦位于这一带。' },
    '1238839944': { levels: 2, floorH: 3.6, style: 'office', shape: 'planetarium', cat: 'teach', desc: '天象厅：实验楼旁的银色半球形穹顶。' },
    '527044089': { levels: 5, style: 'office', cat: 'teach', label: '行政楼（七一楼）', desc: '行政楼，又称七一楼，北侧为七一广场。' },
    '527044088': { levels: 2, floorH: 5.6, style: 'hall', shape: 'hip', pitch: 16, roofColor: '#5f5862', cat: 'teach', desc: '仲和堂（OSM 标注为艺术中心 arts_centre），深色屋顶，位于图书馆东南侧。' },
    '527044116': { levels: 3, style: 'office', cat: 'life', desc: '学生活动中心。' },
    // ---- 运动区 ----
    '527044106': { wallH: 13, domeH: 9, levels: 3, style: 'gym', shape: 'dome', cat: 'sport', desc: '体艺馆（体育艺术馆），椭圆形白色穹顶，位于高一教学楼东侧。' },
    '527767797': { levels: 2, style: 'stand', cat: 'sport', label: '看台', desc: '大操场西南侧的看台/附属建筑。' },
    // ---- 生活区 ----
    '527044101': { levels: 3, style: 'canteen', cat: 'life', desc: '学生食堂。' },
    '527044102': { levels: 3, style: 'canteen', cat: 'life', label: '食堂', desc: '学生食堂（东侧）。' },
    '527044099': { levels: 6, style: 'dorm', cat: 'life', desc: '学生宿舍 C 栋（OSM 标注 6 层）。' },
    '527044100': { levels: 6, style: 'dorm', cat: 'life', desc: '学生宿舍 A 栋，又称一二九楼。' },
    '527044094': { levels: 3, style: 'dorm', cat: 'life', desc: '五一楼（宿舍）。' },
    '527044095': { levels: 6, style: 'dorm', label: '' },
    '527044096': { levels: 6, style: 'dorm', label: '' },
    '527044097': { levels: 6, style: 'dorm', label: '' },
    '527044098': { levels: 5, style: 'dorm', label: '' },
    '527044107': { levels: 5, style: 'dorm', label: '' },
    '527044111': { levels: 5, style: 'dorm', label: '' },
    '527044112': { levels: 5, style: 'dorm', label: '' },
    '527044114': { levels: 7, style: 'residential', cat: 'life', desc: '教工宿舍。' },
    '527044115': { levels: 5, style: 'residential', cat: 'life', label: '教工宿舍（九三楼）', desc: '教工宿舍，又称九三楼。' },
    'r7599244': { levels: 7, style: 'residential', label: '' },
    '527044117': { levels: 4, style: 'residential' },
    '527044118': { levels: 4, style: 'residential' },
    '527044121': { levels: 4, style: 'residential' },
    '527044129': { levels: 2, style: 'villa' },
    '527044130': { levels: 3, style: 'villa', shape: 'hip' },
    '527044131': { levels: 3, style: 'villa', shape: 'hip' },
    '527044132': { levels: 3, style: 'villa', shape: 'hip' },
    '527767803': { levels: 1, floorH: 3, style: 'generic', label: '', noEquip: true }, // 门卫室
    // ---- 西校区（原市警察训练学校） ----
    '527044122': { levels: 4, style: 'dorm', cat: 'west', desc: '金中西校区 I 栋宿舍。西校区原为市警察训练学校，2005 年划归金中。' },
    '527044123': { levels: 4, style: 'dorm', cat: 'west', desc: '金中西校区 J 栋宿舍。' },
    '527044124': { levels: 4, style: 'dorm' },
    '527044125': { levels: 4, style: 'dorm' },
    '593730820': { levels: 2, style: 'generic' },
    '527201455': { levels: 2, style: 'villa', shape: 'hip' },
    '527201456': { levels: 2, style: 'villa', shape: 'hip' },
    '527201457': { levels: 2, style: 'villa', shape: 'hip' },
    '527201458': { levels: 2, style: 'villa', shape: 'hip' },
    '527201459': { levels: 2, style: 'villa', shape: 'hip' },
    '527201460': { levels: 2, style: 'villa', shape: 'hip' },
    '527201461': { levels: 2, style: 'villa', shape: 'hip' },
    '527201462': { levels: 2, style: 'villa', shape: 'hip' },
    '527201463': { levels: 2, style: 'villa', shape: 'hip' },
    // ---- 周边 ----
    '527044113': { levels: 4, style: 'residential', cat: 'around' },
    '527044119': { levels: 2, floorH: 4.6, style: 'church', shape: 'hip', pitch: 30, roofColor: '#5d7d68', cross: true, cat: 'around', desc: '汕头市基督教会礐石堂，校园北侧的绿色坡屋顶建筑。' },
    '1187352359': { shape: 'pavilion', sides: 6, label: '飘然亭', cat: 'scene', roofColor: '#4a5c50', desc: '礐石塔山景区山顶（约海拔 120 m）的飘然亭。' },
  },
  // 景观小品与地标（本地坐标，米；x 向东，y 向北）
  landmarks: [
    { type: 'gate', name: '校门（位置示意）', x: -89, y: -62, angle: 1.3, span: 12, cat: 'scene', desc: '校门位置依据门卫室与校内车道起点推断，造型为示意。' },
    { type: 'pavilion', name: '守素亭', x: -60, y: 53, r: 3.0, sides: 6, cat: 'scene', desc: '守素亭，位于学生活动中心南侧的凉亭（造型为示意）。' },
    { type: 'pavilion', name: '', x: 108, y: -110, r: 3.0, sides: 4, roofColor: '#9e4632', cat: 'scene' },
    { type: 'sail', name: '扬帆（雕塑）', x: 23, y: -71, cat: 'scene', desc: '“扬帆”雕塑，位于高三教学楼西侧（造型为示意）。' },
    { type: 'sundial', name: '日晷', x: 22, y: -18, cat: 'scene', desc: '日晷，位于行政楼（七一楼）西侧绿地。' },
    { type: 'ring', name: '日月晖（雕塑）', x: -12, y: 39, cat: 'scene', desc: '“日月晖”雕塑，位于高二教学楼西南侧绿地（造型为示意）。' },
    { type: 'stone', name: '梦之谷', text: '梦之谷', x: 36, y: 153, angle: 0.2, cat: 'scene', desc: '梦之谷，位于观海平台旁（以景石示意）。' },
    { type: 'label', name: '七一广场', x: 31, y: 50, cat: 'scene' },
    { type: 'label', name: '观海平台', x: 40, y: 160, cat: 'scene', desc: '观海平台：校园北侧的观景平台，可远眺汕头港与对岸市区。' },
    { type: 'label', name: '斯忠地质博物馆', x: -11, y: 160, cat: 'teach' },
    { type: 'label', name: '景观天桥', x: -31, y: -133, cat: 'scene', desc: '2012 年落成的景观天桥，跨越谷底溪流，连通校园与大操场。' },
    { type: 'label', name: '金中西校区', x: -245, y: 122, cat: 'west', desc: '金中西校区：原市警察训练学校，2005 年划归金中。' },
    { type: 'label', name: '学生宿舍（东区）', x: 80, y: 95, cat: 'life' },
  ],
  // 推荐的第一人称出生点
  spawn: { x: -84, y: -60, yaw: -1.2 },
};
