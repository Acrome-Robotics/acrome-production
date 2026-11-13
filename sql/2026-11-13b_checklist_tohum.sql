-- Checklist şablonları: Checklist.xlsx (Update / Products / SMD / TestChecklist / Final Control) sayfalarından üretildi.
-- Önce 2026-11-13_checklist.sql uygulanmış olmalı. Tekrar çalıştırılırsa aynı adlı şablonu atlar.
do $$
declare t bigint;
begin
  if not exists (select 1 from public.checklist_templates where name = 'Acrome Ball Balancing Table') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('BBT', 'Acrome Ball Balancing Table', '01', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Arduino Mega', '0', 1),  -- Update!C5
      (t, 'component', null, 'Arduino Shield', '0', 2),  -- Update!C6
      (t, 'component', null, 'Plug Socket Converter', '0', 3),  -- Update!C7
      (t, 'component', null, 'Acrome Controller', '0', 4),  -- Update!C8
      (t, 'component', null, 'Raspberry Pi/Case', '0', 5),  -- Update!C9
      (t, 'component', null, 'Acrome Powerbox', '0', 6),  -- Update!C10
      (t, 'component', null, 'Ribbon Cable', '2', 7),  -- Update!C11
      (t, 'component', null, 'Power Supply', '0', 8),  -- Update!C12
      (t, 'component', null, 'Raspberry Pi Adapter', '0', 9),  -- Update!C13
      (t, 'component', null, 'Code and Documents USB', '0', 10),  -- Update!C14
      (t, 'component', null, 'Power to Power Cable', '0', 11),  -- Update!C15
      (t, 'component', null, 'Touch Screen Module', '0', 12),  -- Update!C16
      (t, 'component', null, 'Ethernet Cable', '0', 13),  -- Update!C17
      (t, 'component', null, 'Touch Screen Cable', '0', 14),  -- Update!C18
      (t, 'component', null, 'Mini Ethernet Switch', '0', 15),  -- Update!C19
      (t, 'component', null, 'USB B to A', '0', 16),  -- Update!C20
      (t, 'component', null, 'Steel Ball', '0', 17),  -- Update!C21
      (t, 'component', null, 'PS4 Gamepad+Cable', '0', 18),  -- Update!C22
      (t, 'test', null, 'Motor Check', null, 1),  -- TestChecklist!B4
      (t, 'test', null, 'TS Check', null, 2),  -- TestChecklist!B5
      (t, 'test', null, 'Cable Check', null, 3),  -- TestChecklist!B6
      (t, 'test', null, 'Ball Check', null, 4),  -- TestChecklist!B7
      (t, 'test', null, 'Board Check', null, 5),  -- TestChecklist!B8
      (t, 'test', null, 'PID Check', null, 6),  -- TestChecklist!B9
      (t, 'test', null, 'Calibration Check', null, 7);  -- TestChecklist!B10
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Ball&Beam') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('BB', 'Ball&Beam', '02', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Arduino Shield', '0', 1),  -- Update!I8
      (t, 'component', null, 'Arduino Mega', '0', 2),  -- Update!I9
      (t, 'component', null, 'Plug Socket Converter', '0', 3),  -- Update!I10
      (t, 'component', null, 'Acrome Controller', '0', 4),  -- Update!I11
      (t, 'component', null, 'Raspberry Pi', '0', 5),  -- Update!I12
      (t, 'component', null, 'Acrome PowerBox', '0', 6),  -- Update!I13
      (t, 'component', null, 'Ribbon Cable', '2', 7),  -- Update!I14
      (t, 'component', null, 'Power Supply', '0', 8),  -- Update!I15
      (t, 'component', null, 'USB Stick', '0', 9),  -- Update!I16
      (t, 'component', null, 'Power to Power Cable', '0', 10),  -- Update!I17
      (t, 'component', null, 'Potentiometer Cable', '0', 11),  -- Update!I18
      (t, 'component', null, 'USB A to B', '0', 12),  -- Update!I19
      (t, 'component', null, 'Steel Ball', '0', 13),  -- Update!I20
      (t, 'component', null, 'Spare Parts', '0', 14),  -- Update!I21
      (t, 'test', null, 'Motor Check', null, 1),  -- TestChecklist!E4
      (t, 'test', null, 'POT Check', null, 2),  -- TestChecklist!E5
      (t, 'test', null, 'Cable Check', null, 3),  -- TestChecklist!E6
      (t, 'test', null, 'Ball Check', null, 4),  -- TestChecklist!E7
      (t, 'test', null, 'Board Check', null, 5),  -- TestChecklist!E8
      (t, 'test', null, 'PID Check', null, 6),  -- TestChecklist!E9
      (t, 'test', null, 'Calibration Check', null, 7);  -- TestChecklist!E10
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Delta Robot') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('DELTA', 'Delta Robot', '03', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Arduino Shield', '1', 1),  -- Update!O8
      (t, 'component', null, 'Arduino Mega', '1', 2),  -- Update!O9
      (t, 'component', null, 'myRIO', '0', 3),  -- Update!O10
      (t, 'component', null, 'Acrome Controller', '0', 4),  -- Update!O11
      (t, 'component', null, 'Raspberry Pi', '0', 5),  -- Update!O12
      (t, 'component', null, 'Acrome PowerBox', '1', 6),  -- Update!O13
      (t, 'component', null, 'Ribbon Cable', '2', 7),  -- Update!O14
      (t, 'component', null, 'Power Supply', '1', 8),  -- Update!O15
      (t, 'component', null, 'USB Stick', '1', 9),  -- Update!O16
      (t, 'component', null, 'Power to Power Cable', '0', 10),  -- Update!O17
      (t, 'component', null, 'USB TTL Cable', '1', 11),  -- Update!O18
      (t, 'component', null, 'USB A to B', '1', 12),  -- Update!O19
      (t, 'component', null, 'Coin', '6', 13),  -- Update!O20
      (t, 'component', null, 'Stylus End-Effector', '0', 14),  -- Update!O21
      (t, 'component', null, 'Spare Parts', '1', 15);  -- Update!O22
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Delta Robot Python+Matlab+Labview') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('DELTA', 'Delta Robot Python+Matlab+Labview', '03', false) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Acrome Power Card', '1', 1),  -- Products!Q37
      (t, 'component', null, 'Arduino Mega', '1', 2),  -- Products!Q38
      (t, 'component', null, 'Arduino Shield', '1', 3),  -- Products!Q39
      (t, 'component', null, 'myRIO', '1', 4),  -- Products!Q40
      (t, 'component', null, 'Raspberry Pi', '0', 5),  -- Products!Q41
      (t, 'component', null, 'Acrome Controller', '1', 6),  -- Products!Q42
      (t, 'component', null, 'Ribbon Cable', '2', 7),  -- Products!Q43
      (t, 'component', null, 'Arduino USB A to B', '1', 8),  -- Products!Q44
      (t, 'component', null, 'MyRIO USB A to B', '1', 9),  -- Products!Q45
      (t, 'component', null, 'USB TTL Cable', '2', 10),  -- Products!Q46
      (t, 'component', null, 'Power 2 Power Cable', '2', 11),  -- Products!Q47
      (t, 'component', null, 'Code and Documents USB', '1', 12),  -- Products!Q48
      (t, 'component', null, 'Power Supply', '1', 13),  -- Products!Q49
      (t, 'component', null, 'Tablet', '1', 14),  -- Products!Q50
      (t, 'component', null, 'Tablet Charger', '1', 15),  -- Products!Q51
      (t, 'component', null, 'Coin', '3', 16),  -- Products!Q52
      (t, 'component', null, 'Mechanical Parts', '1', 17);  -- Products!Q53
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome Pendulum') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('PEND', 'Acrome Pendulum', '07', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Arduino Mega', '0', 1),  -- Update!C33
      (t, 'component', null, 'Arduino Shield', '0', 2),  -- Update!C34
      (t, 'component', null, 'Acrome Power Box', '0', 3),  -- Update!C35
      (t, 'component', null, 'Acrome Controller', '1', 4),  -- Update!C36
      (t, 'component', null, 'Raspberry Pi', '1', 5),  -- Update!C37
      (t, 'component', null, 'Power Supply', '1', 6),  -- Update!C38
      (t, 'component', null, 'USB Stick', '1', 7),  -- Update!C39
      (t, 'component', null, 'USB A to B', '0', 8),  -- Update!C40
      (t, 'component', null, 'Plug Socket Converter', '0', 9),  -- Update!C41
      (t, 'test', null, 'Motor Check', null, 1),  -- TestChecklist!B13
      (t, 'test', null, 'POT Check', null, 2),  -- TestChecklist!B14
      (t, 'test', null, 'Limit Switch Check', null, 3),  -- TestChecklist!B15
      (t, 'test', null, 'Cable Check', null, 4),  -- TestChecklist!B16
      (t, 'test', null, 'Board Check', null, 5),  -- TestChecklist!B17
      (t, 'test', null, 'PID Check', null, 6),  -- TestChecklist!B18
      (t, 'test', null, 'Calibration Check', null, 7);  -- TestChecklist!B19
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome 4DOF Robot Arm') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('ACROBOT', 'Acrome 4DOF Robot Arm', '05', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Arduino Mega + RAMPS v1.5', '1/1', 1),  -- Update!C51
      (t, 'component', null, 'Raspberry Pi / Case', '1/1', 2),  -- Update!C52
      (t, 'component', null, 'Motor Driver Board', '4', 3),  -- Update!C53
      (t, 'component', null, 'Raspberry Adapter', '1', 4),  -- Update!C54
      (t, 'component', null, 'Power Supply', '1', 5),  -- Update!C55
      (t, 'component', null, 'USB Card', '1', 6),  -- Update!C56
      (t, 'component', null, 'USB TTL Cable', '0', 7),  -- Update!C57
      (t, 'component', null, 'PickPlace Object', '1', 8),  -- Update!C58
      (t, 'component', null, 'USB A to B (Arduino)', '1', 9),  -- Update!C59
      (t, 'component', null, 'Grey Ethernet Cable (RPI-PC Conn)', '1', 10);  -- Update!C60
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome Stewart PRO') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('STEWART', 'Acrome Stewart PRO', '08', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Arduino Mega', '0', 1),  -- Update!C66
      (t, 'component', null, 'Arduino Shield', '0', 2),  -- Update!C67
      (t, 'component', null, 'myRIO', '0', 3),  -- Update!C68
      (t, 'component', null, 'Acrome Controller', '0', 4),  -- Update!C69
      (t, 'component', null, 'Raspberry Pi', '0', 5),  -- Update!C70
      (t, 'component', null, 'Motor Driver Board', '1', 6),  -- Update!C71
      (t, 'component', null, 'Ribbon Cable', '4', 7),  -- Update!C72
      (t, 'component', null, 'Power Supply', '1', 8),  -- Update!C73
      (t, 'component', null, 'Code and Documents USB', '1', 9),  -- Update!C74
      (t, 'component', null, 'Power to Power Cable', '2', 10),  -- Update!C75
      (t, 'component', null, 'IMU EthernetCable (Black)', '1', 11),  -- Update!C76
      (t, 'component', null, 'RPi-PC COMM Ethernet Cable (White)', '1', 12),  -- Update!C77
      (t, 'component', null, 'USB-Ethernet Converter', '0', 13),  -- Update!C78
      (t, 'component', null, 'USB B to A', '0', 14),  -- Update!C79
      (t, 'component', null, 'USB TTL Cable', '0', 15),  -- Update!C80
      (t, 'component', null, 'Plug Socket Converter', '0', 16),  -- Update!C81
      (t, 'component', null, 'Allen Key', '1', 17),  -- Update!C82
      (t, 'component', null, 'M4x30 imbusbolt', '48', 18),  -- Update!C83
      (t, 'component', null, 'M4 Spring Washer', '0', 19),  -- Update!C84
      (t, 'component', null, 'IMU Sensor/Box', '1/1', 20),  -- Update!C85
      (t, 'component', null, 'Top Plate/Bottom Plate', '1/1', 21),  -- Update!C86
      (t, 'test', null, 'Motor Check', null, 1),  -- TestChecklist!B22
      (t, 'test', null, 'POT Check', null, 2),  -- TestChecklist!B23
      (t, 'test', null, 'Limit Switch Check', null, 3),  -- TestChecklist!B24
      (t, 'test', null, 'Cable Check', null, 4),  -- TestChecklist!B25
      (t, 'test', null, 'Board Check', null, 5),  -- TestChecklist!B26
      (t, 'test', null, 'PID Check', null, 6),  -- TestChecklist!B27
      (t, 'test', null, 'Calibration Check', null, 7),  -- TestChecklist!B28
      (t, 'final', '1. MECHANICAL CHECKS', 'All bolts and nuts tightened to torque value', null, 1),  -- Final Control!B10: Tüm cıvata ve somunların tork değerinde sıkılığı
      (t, 'final', '1. MECHANICAL CHECKS', 'Linear actuator bearings free of play', null, 2),  -- Final Control!B11: Lineer eyleyici (actuator) yataklarının boşluksuz olması
      (t, 'final', '1. MECHANICAL CHECKS', 'Ball joints move freely', null, 3),  -- Final Control!B12: Küresel eklemlerin (Ball Joints) hareket serbestliği
      (t, 'final', '1. MECHANICAL CHECKS', 'Chassis and platform surfaces free of scratches and deformation', null, 4),  -- Final Control!B13: Şasi ve platform yüzeyinde çizik, deformasyon kontrolü
      (t, 'final', '1. MECHANICAL CHECKS', 'Condition of electronics enclosures', null, 5),  -- Final Control!B14: Elektronik muhafazaları durumu
      (t, 'final', '1. MECHANICAL CHECKS', 'Overall structural rigidity after assembly', null, 6),  -- Final Control!B15: Montaj sonrası genel yapısal rijitlik kontrolü
      (t, 'final', '2. ELECTRICAL AND CABLING', 'General condition of cables (crushed, bare wire, deformation)', null, 7),  -- Final Control!B17: Kabloların genel durumu (Ezik, Cıplak Tel, Deformasyon)
      (t, 'final', '2. ELECTRICAL AND CABLING', 'DC motor socket connections secure', null, 8),  -- Final Control!B18: DC motor soket bağlantılarının sabitliğini kontrolü
      (t, 'final', '2. ELECTRICAL AND CABLING', 'IMU sensor mounted in the correct orientation', null, 9),  -- Final Control!B19: IMU sensörünün doğru yönde takılı olması
      (t, 'final', '2. ELECTRICAL AND CABLING', 'Emergency stop button functional', null, 10),  -- Final Control!B20: Acil durdurma butonu fonksiyonelliği
      (t, 'final', '2. ELECTRICAL AND CABLING', 'Power supply voltage check (12V ± 0.1V), 110/220', null, 11),  -- Final Control!B21: Güç kaynağı voltaj değerlerinin kontrolü (12V +- 0.1V), 110/220
      (t, 'final', '2. ELECTRICAL AND CABLING', 'Regulator LED on the board', null, 12),  -- Final Control!B22: Kartın Üzerindeki Regülatör LED kontrolü
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Emergency stop button and motor power check', null, 13),  -- Final Control!B24: Acil Stop butonu ve Motor Power kontrolü
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Actuator upper and lower limit calibration and verification (5% tolerance)', null, 14),  -- Final Control!B25: Aktüatörlerin üst ve alt limit kalibrasyonu, doğrulaması (%5 tolerans)
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'IMU data check', null, 15),  -- Final Control!B26: IMU verisinin kontrolü
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Software version check and calibration data record', null, 16),  -- Final Control!B27: Yazılım versiyonu kontrolü ve kalibrasyon verisi kaydı
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Z-axis repeatability and precision check', null, 17),  -- Final Control!B28: Z ekseninde tekrarlanabilirlik ve hassasiyet kontrolü
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', '6-DOF motion test (limit check) (+1% tolerance)', null, 18),  -- Final Control!B29: 6-DOF Hareket Testi (Limit kontrolü) (+%1 tolerans)
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Operation under nominal load (payload) and temperature check (10 min RPY)', null, 19),  -- Final Control!B30: Nominal yük altında (Payload) çalıştırma ve sıcaklık kontrolü (10 dk RPY)
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Linear and angular velocity check (5% tolerance)', null, 20),  -- Final Control!B31: Lineer ve açısal hız kontrolü (%5 tolerans)
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Network connection latency check (<10 ms)', null, 21),  -- Final Control!B32: Network bağlantı gecikme kontrolü (<10ms)
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'Python API check', null, 22),  -- Final Control!B33: Python API kontrolü
      (t, 'final', '3. FUNCTIONAL AND SOFTWARE TESTS', 'DIO test', null, 23),  -- Final Control!B34: DIO Testi
      (t, 'final', '4. PACKAGING AND SHIPMENT', 'All power and data cables included', null, 24),  -- Final Control!B36: Güç ve veri kablolarının eksiksizliği
      (t, 'final', '4. PACKAGING AND SHIPMENT', 'User manual, technical documentation and software on USB flash drive', null, 25),  -- Final Control!B37: Kullanım kılavuzu ve teknik dökümantasyon ve yazılımların USB Flash diski
      (t, 'final', '4. PACKAGING AND SHIPMENT', 'Product label and serial number correct', null, 26);  -- Final Control!B38: Ürün etiketi ve seri no doğruluğu
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome 1DOF Copter') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('COPTER1D', 'Acrome 1DOF Copter', '06', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Raspberry Pi/Case', '0', 1),  -- Update!C93
      (t, 'component', null, 'Acrome SMD RED/ Case', '0', 2),  -- Update!C94
      (t, 'component', null, 'Acrome SMD USB Gateway', '0', 3),  -- Update!C95
      (t, 'component', null, 'USB TTL Cable', '0', 4),  -- Update!C96
      (t, 'component', null, 'Power to Power Cable', '0', 5),  -- Update!C97
      (t, 'component', null, 'Arduino Mega', '1', 6),  -- Update!C98
      (t, 'component', null, 'Arduino Shield', '1', 7),  -- Update!C99
      (t, 'component', null, 'USB Stick', '1', 8),  -- Update!C100
      (t, 'component', null, 'Acrome PowerBox', '1', 9),  -- Update!C101
      (t, 'component', null, 'USB A to B', '1', 10),  -- Update!C102
      (t, 'component', null, 'Power Supply', '1', 11),  -- Update!C103
      (t, 'component', null, 'Raspberry Pi Power Supply', '0', 12),  -- Update!C104
      (t, 'component', null, 'Ethernet Cable (Grey)', '0', 13),  -- Update!C105
      (t, 'component', null, 'RJ11 Cable', '0', 14),  -- Update!C106
      (t, 'component', null, 'Mechanical Parts', '1', 15);  -- Update!C107
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome 2DOF Copter') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('COPTER3D', 'Acrome 2DOF Copter', '11', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Raspberry Pi/Case', '1', 1),  -- Update!I93
      (t, 'component', null, 'Acrome SMD RED/ Case', '2', 2),  -- Update!I94
      (t, 'component', null, 'Acrome SMD USB Gateway', '1', 3),  -- Update!I95
      (t, 'component', null, 'USB TTL Cable', '0', 4),  -- Update!I96
      (t, 'component', null, 'Power to Power Cable', '1', 5),  -- Update!I97
      (t, 'component', null, 'USB Stick', '1', 6),  -- Update!I98
      (t, 'component', null, 'Power Supply', '1', 7),  -- Update!I99
      (t, 'component', null, 'Raspberry Pi Power Supply', '1', 8),  -- Update!I100
      (t, 'component', null, 'Ethernet Cable (Grey)', '1', 9),  -- Update!I101
      (t, 'component', null, 'RJ11 Cable', '4', 10),  -- Update!I102
      (t, 'component', null, 'Mechanical Parts', '1', 11);  -- Update!I103
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome 3DOF Helicopter') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('COPTER3D', 'Acrome 3DOF Helicopter', '12', false) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Main Board', '0', 1),  -- Update!C116
      (t, 'component', null, 'IO Module', '0', 2),  -- Update!C117
      (t, 'component', null, 'Motor Module', '0', 3),  -- Update!C118
      (t, 'component', null, 'USB A to C Cable', '0', 4),  -- Update!C119
      (t, 'component', null, 'Power Supply', '0', 5),  -- Update!C120
      (t, 'component', null, 'Plug Socket Converter', '0', 6),  -- Update!C121
      (t, 'component', null, 'USB Stick', '0', 7),  -- Update!C122
      (t, 'component', null, 'Bottom Plate', '0', 8);  -- Update!C123
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome SMD Education Kit') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('SMD_EDU', 'Acrome SMD Education Kit', '13', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'SMD Red BDC Motor Driver', '1', 1),  -- SMD!B5
      (t, 'component', null, 'USB Gateway Module', '1', 2),  -- SMD!B6
      (t, 'component', null, 'Ambient Light Sensor Module', '1', 3),  -- SMD!B7
      (t, 'component', null, 'Button Module', '1', 4),  -- SMD!B8
      (t, 'component', null, 'Buzzer Module', '1', 5),  -- SMD!B9
      (t, 'component', null, 'Reflectance Sensor Module', '1', 6),  -- SMD!B10
      (t, 'component', null, 'Potentiometer Module', '1', 7),  -- SMD!B11
      (t, 'component', null, 'RGB LED Module', '1', 8),  -- SMD!B12
      (t, 'component', null, 'Servo Module', '1', 9),  -- SMD!B13
      (t, 'component', null, 'IMU Module', '1', 10),  -- SMD!B14
      (t, 'component', null, 'Joystick Module', '1', 11),  -- SMD!B15
      (t, 'component', null, 'Ultrasonic Distance Sensor Module', '1', 12),  -- SMD!B16
      (t, 'component', null, '11x19 Plate', '3', 13),  -- SMD!B17
      (t, 'component', null, '2x2 Plate Package', '1', 14),  -- SMD!B18
      (t, 'component', null, '3x5 Plate Package', '1', 15),  -- SMD!B19
      (t, 'component', null, 'Wheel Package', '1', 16),  -- SMD!B20
      (t, 'component', null, 'Motor L Mount Package', '1', 17),  -- SMD!B21
      (t, 'component', null, '100 RPM BDC Motor with Encoder', '1', 18),  -- SMD!B22
      (t, 'component', null, 'Slot Joint M3 Package', '7', 19),  -- SMD!B23
      (t, 'component', null, '90° Joint Package', '1', 20),  -- SMD!B24
      (t, 'component', null, 'U Joint Package', '1', 21),  -- SMD!B25
      (t, 'component', null, 'Power Adaptor', '1', 22);  -- SMD!B26
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Acrome SMD AMR Kit') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('SMD_OTHER', 'Acrome SMD AMR Kit', '14', false) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'SMD Red BDC Motor Driver', '2', 1),  -- SMD!B34
      (t, 'component', null, 'USB Gateway Module', '1', 2),  -- SMD!B35
      (t, 'component', null, 'IMU Module', '0', 3),  -- SMD!B36
      (t, 'component', null, 'Ultrasonic Distance Sensor Module', '0', 4),  -- SMD!B37
      (t, 'component', null, 'Buzzer Module', '0', 5),  -- SMD!B38
      (t, 'component', null, 'RGB LED Module', '0', 6),  -- SMD!B39
      (t, 'component', null, '11x19 Plate', '2', 7),  -- SMD!B40
      (t, 'component', null, '5x19 Plate', '3', 8),  -- SMD!B41
      (t, 'component', null, '9x19 Plate', '1', 9),  -- SMD!B42
      (t, 'component', null, '3x19 Plate', '2', 10),  -- SMD!B43
      (t, 'component', null, 'Motor L Mount Package', '2', 11),  -- SMD!B44
      (t, 'component', null, '100 RPM BDC Motor with Encoder', '2', 12),  -- SMD!B45
      (t, 'component', null, 'Wheel Package', '2', 13),  -- SMD!B46
      (t, 'component', null, 'Ball Wheel Package', '1', 14),  -- SMD!B47
      (t, 'component', null, 'Caster Wheel Package', '0', 15),  -- SMD!B48
      (t, 'component', null, 'Add-on Mount Package', '0', 16),  -- SMD!B49
      (t, 'component', null, 'Slot Joint M3 Package', '3', 17),  -- SMD!B50
      (t, 'component', null, 'Slot Joint M2 Package', '2', 18),  -- SMD!B51
      (t, 'component', null, '90° Joint Package', '3', 19),  -- SMD!B52
      (t, 'component', null, '120° Joint Package', '2', 20),  -- SMD!B53
      (t, 'component', null, '60° Joint Package', '2', 21),  -- SMD!B54
      (t, 'component', null, 'Power Adaptor', '1', 22),  -- SMD!B55
      (t, 'component', null, 'Raspberry Pi', '1', 23),  -- SMD!B56
      (t, 'component', null, 'Lidar Sensor', '1', 24),  -- SMD!B57
      (t, 'component', null, 'BMS Board', '1', 25),  -- SMD!B58
      (t, 'component', null, 'Power Distribution Board', '1', 26),  -- SMD!B59
      (t, 'component', null, 'Battery', '1', 27),  -- SMD!B60
      (t, 'component', null, 'Battery Charging unit', '1', 28);  -- SMD!B61
  end if;
  if not exists (select 1 from public.checklist_templates where name = 'Turtlebot + Raspberry pi 4') then
    insert into public.checklist_templates(product_code, name, serial_code, is_default) values ('MRK', 'Turtlebot + Raspberry pi 4', '10', true) returning id into t;
    insert into public.checklist_template_items(template_id, section, grp, name, qty, sort) values
      (t, 'component', null, 'Mobile Robot Kit', '1', 1),  -- Products!K52
      (t, 'component', null, 'Battery', '0', 2),  -- Products!K53
      (t, 'component', null, 'Maze parts', '1', 3),  -- Products!K54
      (t, 'component', null, 'Lidar cable', '1', 4),  -- Products!K55
      (t, 'component', null, 'USB Stick', '1', 5);  -- Products!K56
  end if;
end $$;

-- üretimdeki siparişlerin checklist'lerini şimdi aç (sonrası tetikleyiciyle)
select public._checklist_sync(id) from public.deals where status = 'production';
