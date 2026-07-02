export const minImageCount = 1;
export const maxImageCount = 20;
export const defaultImageCount = 4;
export const defaultImageStyle = "제품 단독컷";
export const diversityImageStyles = ["자동 다양화", "여러 스타일"];

export const imageStyleDefinitions = [
  { style: "제품 단독컷", purpose: "대표 상품 식별", focus: "제품 실루엣과 핵심 소재가 한눈에 보이는 단정한 단독 구성" },
  { style: "라이프스타일컷", purpose: "생활 맥락 설득", focus: "실제 사용자가 있는 자연스러운 생활 공간과 감정적인 사용 맥락" },
  { style: "상세페이지 배너", purpose: "상단 히어로 배너", focus: "여백과 짧은 카피 영역을 확보한 상세페이지 첫 화면 구성" },
  { style: "사용 장면", purpose: "기능 사용 설명", focus: "손, 책상, 주변 도구와 함께 사용 방법이 직관적으로 보이는 장면" },
  { style: "소셜 광고컷", purpose: "피드 클릭 유도", focus: "강한 대비, 짧은 훅 카피 자리, 모바일 피드에서 눈에 띄는 구도" },
  { style: "프리미엄 클로즈업", purpose: "품질감 강조", focus: "소재, 마감, 디테일을 가까운 거리에서 보여주는 고급 조명" },
  { style: "구성품/패키지컷", purpose: "구성 정보 전달", focus: "본품, 패키지, 부속품을 질서 있게 배치한 언박싱형 구성" },
  { style: "리뷰/UGC 느낌", purpose: "실사용 신뢰 형성", focus: "사용자 촬영처럼 자연스러운 앵글과 후기 카드가 들어갈 여백" },
  { style: "정보형 인포그래픽", purpose: "핵심 스펙 요약", focus: "아이콘, 콜아웃, 비교 포인트가 들어갈 깔끔한 정보형 레이아웃" },
  { style: "시즌/선물컷", purpose: "시즌·기프트 제안", focus: "선물 포장, 계절 소품, 따뜻한 분위기로 구매 명분을 만드는 장면" },
];

export const imageStyleOptions = [
  ...diversityImageStyles,
  ...imageStyleDefinitions.map((definition) => definition.style),
];

export const singleStylePurposes = [
  "대표 썸네일",
  "상세페이지 중간 섹션",
  "구매 포인트 강조",
  "모바일 광고 소재",
  "마켓 리스트용 이미지",
  "기능 설명 컷",
  "패키지 확인 컷",
  "후기 영역 보조 컷",
  "비교·스펙 안내 컷",
  "프로모션 보조 컷",
];

export const visualVariations = [
  { composition: "정면 3/4 앵글, 제품을 중앙보다 살짝 왼쪽에 배치", background: "넓은 음영 여백", lighting: "부드러운 확산광", copy: "오른쪽 상단 짧은 헤드라인 여백", props: "불필요한 소품 최소화", distance: "중간 거리" },
  { composition: "낮은 시점의 사선 구도, 제품 높이감을 강조", background: "밝은 실내 배경", lighting: "측면 자연광", copy: "하단 안전 영역", props: "생활감을 주는 작은 소품 1개", distance: "근접 중거리" },
  { composition: "와이드 배너형 좌우 분할 구도", background: "깨끗한 그라데이션 배경", lighting: "균일한 스튜디오 조명", copy: "왼쪽 넓은 카피 블록", props: "브랜드 무드를 해치지 않는 보조 오브젝트", distance: "중간 거리" },
  { composition: "손이 제품을 사용하는 순간을 포착", background: "데스크 또는 사용 환경", lighting: "따뜻한 실내광", copy: "상단 작은 라벨 영역", props: "실제 사용 도구", distance: "클로즈업" },
  { composition: "모바일 피드용 강한 중심 구도", background: "대비가 있는 단색 또는 패턴", lighting: "선명한 하이라이트", copy: "굵은 한 줄 훅 카피 자리", props: "시선을 끄는 컬러 포인트", distance: "중간 클로즈업" },
  { composition: "매크로 디테일 중심 구도", background: "어두운 프리미엄 톤", lighting: "림라이트와 반사광", copy: "작은 캡션 여백", props: "고급 소재감을 돕는 표면", distance: "아주 가까운 거리" },
  { composition: "구성품을 위에서 내려다본 플랫레이", background: "중립적인 테이블", lighting: "균일한 탑라이트", copy: "구성품명 라벨 영역", props: "패키지와 부속품", distance: "전체 구성 거리" },
  { composition: "사용자가 직접 찍은 듯한 약간 비대칭 구도", background: "현실적인 생활 공간", lighting: "자연스러운 혼합광", copy: "후기 말풍선 또는 별점 여백", props: "손, 컵, 노트 등 일상 소품", distance: "중간 거리" },
  { composition: "제품 주변에 콜아웃 포인트를 배치하는 정보형 구도", background: "밝은 흰색 또는 연회색", lighting: "그림자가 적은 조명", copy: "아이콘 3개와 짧은 스펙 영역", props: "정보 전달용 라인/배지", distance: "중간 거리" },
  { composition: "선물 패키지와 함께 대각선 배치", background: "계절감 있는 따뜻한 배경", lighting: "부드러운 하이라이트", copy: "선물 제안 카피 여백", props: "리본, 카드, 시즌 소품", distance: "중간 클로즈업" },
];
