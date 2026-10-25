-- ฐานทดสอบกรณีขอบ (ข้อมูลสังเคราะห์) วันที่ 2026-10-25, "ตอนนี้" = 10:30
DROP TABLE IF EXISTS ovst, patient, kskdepartment, opd_dep_queue, service_time, ovst_service_time;
CREATE TABLE ovst (vn VARCHAR(13) PRIMARY KEY, hn VARCHAR(9), vstdate DATE, vsttime TIME, oqueue INT, main_dep CHAR(3), cur_dep CHAR(3));
CREATE TABLE patient (hn VARCHAR(9) PRIMARY KEY, pname VARCHAR(20), fname VARCHAR(80), lname VARCHAR(80));
CREATE TABLE kskdepartment (depcode CHAR(3) PRIMARY KEY, department VARCHAR(150));
CREATE TABLE opd_dep_queue (id INT AUTO_INCREMENT PRIMARY KEY, vn VARCHAR(13), depcode CHAR(3), depq INT, time_in DATETIME NULL, time_call DATETIME NULL, time_out DATETIME NULL);
CREATE TABLE service_time (vn VARCHAR(13) PRIMARY KEY, vstdate DATE, reg_in TIME, reg_out TIME, pay_in TIME, pay_out TIME, drug_in TIME, drug_call TIME, drug_out TIME);
CREATE TABLE ovst_service_time (id INT AUTO_INCREMENT PRIMARY KEY, vn VARCHAR(13), service_code VARCHAR(5), begin_datetime DATETIME NULL, end_datetime DATETIME NULL);
INSERT INTO kskdepartment VALUES ('001','ห้องบัตร'),('010','ซักประวัติอายุรกรรม'),('011','OPD อายุรกรรม'),('090','การเงิน'),('091','ห้องยา'),('099','ศูนย์ส่งต่อ <b>ทดสอบ</b>');
INSERT INTO ovst VALUES
 ('V1','000123456','2026-10-25','07:50:00',1,'011','091'),
 ('V2','000222222','2026-10-25','07:55:00',2,'011','011'),
 ('V3','000333333','2026-10-25','07:58:00',3,'011','011'),
 ('V4','000444444','2026-10-25','06:00:00',4,'011','011'),
 ('V5','000555555','2026-10-25','08:00:00',5,'011','001'),
 ('V6','000666666','2026-10-25','09:00:00',6,'099','099'),
 ('V8','000888888','2026-10-25','10:00:00',8,'011','011'),
 ('V9','000999999','2026-10-25','07:00:00',9,'011','001'),
 ('VY','000111111','2026-10-24','09:00:00',1,'011','011');
INSERT INTO patient VALUES ('000123456','นาย','ชื่อจริงห้ามหลุด','นามสกุลห้ามหลุด');
INSERT INTO opd_dep_queue (vn,depcode,depq,time_in,time_call,time_out) VALUES
 ('V1','010',11,'2026-10-25 08:00','2026-10-25 08:10','2026-10-25 08:15'),
 ('V1','011',21,'2026-10-25 08:16','2026-10-25 09:00','2026-10-25 09:10'),
 ('V2','010',12,'2026-10-25 08:00','2026-10-25 08:05','2026-10-25 08:20'),
 ('V2','011',22,NULL,'2026-10-25 09:00',NULL),
 ('V3','010',13,'2026-10-25 08:00','2026-10-25 08:05',NULL),
 ('V3','011',23,'2026-10-25 08:30',NULL,NULL),
 ('V4','011',24,'2026-10-25 06:00',NULL,NULL),
 ('V6','099',1,'2026-10-25 09:00',NULL,NULL),
 ('V8','011',28,'2026-10-25 10:05','2026-10-25 11:00',NULL),
 ('VY','011',1,'2026-10-24 09:00','2026-10-24 09:30','2026-10-24 09:40');
INSERT INTO service_time VALUES
 ('V1','2026-10-25','07:50:00','07:55:00','00:00:00','00:00:00','09:20:00','09:30:00','09:35:00'),
 ('V5','2026-10-25','00:00:00','00:00:00','00:00:00','00:00:00','00:00:00','00:00:00','00:00:00'),
 ('V9','2026-10-25','07:00:00','07:05:00','00:00:00','00:00:00','00:00:00','00:00:00','00:00:00');
