export interface DenominationGroup {
  group: string;
  options: string[];
}

export const DENOMINATION_GROUPS: DenominationGroup[] = [
  {
    group: 'Baptist',
    options: [
      'Southern Baptist Convention (SBC)',
      'American Baptist Churches (ABC)',
      'Independent Baptist',
      'Reformed Baptist',
      'Missionary Baptist',
      'Free Will Baptist',
      'Primitive Baptist',
      'Progressive National Baptist',
      'General Baptist',
    ],
  },
  {
    group: 'Methodist',
    options: [
      'United Methodist (UMC)',
      'Free Methodist',
      'Wesleyan Church',
      'African Methodist Episcopal (AME)',
      'African Methodist Episcopal Zion (AMEZ)',
      'Christian Methodist Episcopal (CME)',
      'Evangelical Methodist',
      'Global Methodist Church',
    ],
  },
  {
    group: 'Presbyterian & Reformed',
    options: [
      'Presbyterian Church in America (PCA)',
      'Presbyterian Church (USA)',
      'Reformed Church in America (RCA)',
      'Christian Reformed Church (CRC)',
      'Evangelical Presbyterian Church (EPC)',
      'Orthodox Presbyterian Church (OPC)',
      'Associate Reformed Presbyterian',
      'United Reformed Churches (URCNA)',
    ],
  },
  {
    group: 'Lutheran',
    options: [
      'Lutheran Church–Missouri Synod (LCMS)',
      'Evangelical Lutheran Church in America (ELCA)',
      'Wisconsin Evangelical Lutheran Synod (WELS)',
      'Lutheran Church–Canada',
      'North American Lutheran Church (NALC)',
    ],
  },
  {
    group: 'Anglican & Episcopal',
    options: [
      'Episcopal Church (TEC)',
      'Anglican Church in North America (ACNA)',
      'Reformed Episcopal Church',
      'Anglican Mission in Americas',
    ],
  },
  {
    group: 'Pentecostal',
    options: [
      'Assemblies of God',
      'Church of God (Cleveland, TN)',
      'Church of God in Christ (COGIC)',
      'International Church of the Foursquare Gospel',
      'United Pentecostal Church International (UPCI)',
      'Pentecostal Holiness Church (IPHC)',
      'Church of God of Prophecy',
      'Open Bible Churches',
    ],
  },
  {
    group: 'Charismatic',
    options: [
      'Vineyard Churches',
      'Word of Faith',
      'New Apostolic Reformation (NAR)',
      'Charismatic Independent',
      'International House of Prayer (IHOP) Affiliated',
    ],
  },
  {
    group: 'Non-Denominational & Evangelical',
    options: [
      'Non-Denominational Evangelical',
      'Community Church (Independent)',
      'Bible Church (Independent)',
      'Calvary Chapel',
      'Acts 29 Network',
      'Willow Creek Association',
      'Evangelical Covenant Church',
      'Christian & Missionary Alliance (C&MA)',
    ],
  },
  {
    group: 'Holiness',
    options: [
      'Church of the Nazarene',
      'Salvation Army',
      'Church of God (Anderson, IN)',
      'Wesleyan Holiness (Independent)',
      'Church of God (Holiness)',
    ],
  },
  {
    group: 'Restoration Movement',
    options: [
      'Churches of Christ (Non-Instrumental)',
      'Christian Church (Disciples of Christ)',
      'Christian Churches / Churches of Christ (Independent)',
    ],
  },
  {
    group: 'Anabaptist',
    options: [
      'Mennonite Church USA',
      'General Conference Mennonite',
      'Brethren in Christ',
      'Church of the Brethren',
      'Conservative Mennonite',
      'Amish Mennonite',
    ],
  },
  {
    group: 'Quaker',
    options: [
      'Evangelical Friends International',
      'Friends United Meeting',
      'Friends General Conference',
    ],
  },
  {
    group: 'Adventist',
    options: [
      'Seventh-day Adventist',
      'Advent Christian Church',
    ],
  },
  {
    group: 'Other Protestant',
    options: [
      'United Church of Christ (UCC)',
      'Christian Church (generic)',
      'Evangelical Free Church of America (EFCA)',
      'Fellowship of Christian Assemblies',
      'International Fellowship of Christian Churches',
      'Grace Brethren',
      'Church of God General Conference',
    ],
  },
];

export const CONGREGATION_SIZES = [
  'Any Size',
  'Small (under 100)',
  'Mid-Size (100–500)',
  'Large (500–2,000)',
  'Mega-Church (2,000+)',
] as const;

export const CHURCH_AGES = [
  'Any Age',
  'New Plant (under 10 years)',
  'Young (10–25 years)',
  'Established (25–75 years)',
  'Historic (75–150 years)',
  'Legacy (150+ years)',
] as const;

export const SERVICE_STYLES = [
  'Any Style',
  'Traditional / Liturgical',
  'Contemporary',
  'Blended / Hybrid',
  'Charismatic / Expressive',
  'High Church / Formal',
  'Seeker-Sensitive',
  'Simple / House Church',
] as const;
