import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import path from 'path';
import multer from "multer";
import env from 'dotenv'

const app = express();
const port = 3000;
// const slatRound = 1;
let customer = [];
let holder = [];
let amount = 'NULL'
var usernameLogin = "NULL";
var passwordLogin = "NULL";
env.config();

//Database connection from pgAdmin
const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});
db.connect();

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

// Uploding image in bank profile
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads"); 
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});
const uploadInMulter = multer({ storage: storage });

// --------------------- GET ROUTERS -----------------------------

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/new_acc", (req, res) => {
  res.render("new_account.ejs");
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/about", (req, res) => {
  res.render("about.ejs");
});

app.get("/help", (req, res) => {
  res.render("help.ejs");
});

// --------------------- POST ROUTERS -----------------------------

//Creating New Account
app.post("/created", uploadInMulter.single("profileImage"), async (req, res) => {
  const result = (await db.query("SELECT account_no FROM account_holder")).rows;
  let preACC = result.map(row => row.account_no); // Extract existing account numbers

  // Generate unique account number
  function generateUniqueAccountNo(preACC) {
    let randomGenAccountNo;
    do {
      const random = Math.floor(11111 + Math.random() * 99999);
      const year = new Date().getFullYear();
      randomGenAccountNo = `NXB${year}0${random}`;
    } while (preACC.includes(randomGenAccountNo));

    preACC.push(randomGenAccountNo);
    return randomGenAccountNo;
  }

  const newAccountNo = generateUniqueAccountNo(preACC);

  const newAccount = {
    firstname: req.body.firstName,
    lastname: req.body.lastName,
    username: req.body.userName,
    password: req.body.password,
    phone_no: req.body.phone,
    email: req.body.email,
    address: req.body.address,
    img: req.file ? `/uploads/${req.file.filename}` : null, // Save the file path
    balance: req.body.Deposit,
    acc_no: newAccountNo,
  };

  // Insert new account into database
  await db.query(
    "INSERT INTO account_holder(first_name, last_name, user_name, password, phone_no, email, address, balance, account_no, profile_image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [
      newAccount.firstname,
      newAccount.lastname,
      newAccount.username,
      newAccount.password,
      newAccount.phone_no,
      newAccount.email,
      newAccount.address,
      newAccount.balance,
      newAccount.acc_no,
      newAccount.img,
    ]
  );

  res.render("login.ejs");
});


// checking authentication and login to acces page
app.post("/transactions", async (req, res) => {
  const newAccData = await db.query("select * from account_holder");
  customer = newAccData.rows;

  //client to server
  usernameLogin = req.body.username;
  passwordLogin = req.body.password;

  let isAuthenticated = false;

  for (let i = 0; i < customer.length; i++) {
    const storedPassword = customer[i].password;
    // const isMatch = await bcrypt.compare(passwordLogin, storedPassword);
    if (
      customer[i].user_name === usernameLogin &&
      storedPassword === passwordLogin
    ) {
      isAuthenticated = true;
      holder = customer[i];
      break;
    }
  }
  if (isAuthenticated) {
    res.render("acces.ejs", { holder });
  } else {
    res.send("Not found");
  }
});

// Amount Transaction (deposit)
app.post("/transactions/deposit", async (req, res) => {
   amount = parseInt(req.body.deposit);
   usernameLogin = req.body.username;
   passwordLogin = req.body.password;

  if (amount > 0) {
    const result = await db.query(
      "UPDATE account_holder SET balance = balance + $1 WHERE user_name = $2 AND password = $3 RETURNING *",
      [amount, usernameLogin, passwordLogin]
    );

    if (result.rows.length === 0) {
      return res.send("Account not found or incorrect credentials.");
    }

    const holder = result.rows[0];
    console.log(holder.balance);
    res.render("acces.ejs", { holder });
  } else {
    res.send("Deposit amount must be greater than 0.");
  }
});

// Amount Transaction (withdraw)
app.post("/transactions/withdraw", async (req, res) => {
   amount = parseInt(req.body.withdraw);
   usernameLogin = req.body.username;
   passwordLogin = req.body.password;

  if (amount > 0) {
    const result = await db.query(
      "UPDATE account_holder SET balance = balance - $1 WHERE user_name = $2 AND password = $3 AND balance >= $1 RETURNING *",
      [amount, usernameLogin, passwordLogin]
    );

    if (result.rows.length === 0) {
      console.log("Error: Account not found or insufficient balance.");
      return res.send("Insufficient balance or account not found.");
    }

    const holder = result.rows[0];
    console.log(holder.balance);
    res.render("acces.ejs", { holder });
  } else {
    res.send("Withdrawal amount must be greater than 0.");
  }
});

// Amount Transaction (trasfer)

app.post("/transactions/transfer", async (req, res) => {
   amount = parseInt(req.body.transfer);
   usernameLogin = req.body.username;
   passwordLogin = req.body.password;
  let recipientAccountNumber = req.body.accountNumber;

  if (amount > 0) {
    // Start a transaction to ensure atomicity
    try {
      await db.query('BEGIN');

      // Check if sender has enough balance
      const senderResult = await db.query(
        "SELECT balance FROM account_holder WHERE user_name = $1 AND password = $2",
        [usernameLogin, passwordLogin]
      );

      if (senderResult.rows.length === 0) {
        return res.send("Sender account not found or incorrect credentials.");
      }

      const senderBalance = senderResult.rows[0].balance;
      if (senderBalance < amount) {
        return res.send("Insufficient balance for transfer.");
      }

      // Reduce sender balance
      await db.query(
        "UPDATE account_holder SET balance = balance - $1 WHERE user_name = $2 AND password = $3",
        [amount, usernameLogin, passwordLogin]
      );

      // Increase recipient balance
      const recipientResult = await db.query(
        "SELECT balance FROM account_holder WHERE account_no = $1",
        [recipientAccountNumber]
      );

      if (recipientResult.rows.length === 0) {
        return res.send("Recipient account not found.");
      }

      await db.query(
        "UPDATE account_holder SET balance = balance + $1 WHERE account_no = $2",
        [amount, recipientAccountNumber]
      );

      // Commit the transaction
      await db.query('COMMIT');

      // Retrieve the updated sender details
      const updatedSenderResult = await db.query(
        "SELECT * FROM account_holder WHERE user_name = $1 AND password = $2",
        [usernameLogin, passwordLogin]
      );

      const sender = updatedSenderResult.rows[0];
      console.log(sender.balance);
      res.render("acces.ejs", { holder: sender });

    } catch (error) {
      // Rollback in case of error
      await db.query('ROLLBACK');
      console.error(error);
      res.send("Error occurred during the transfer.");
    }
  } else {
    res.send("Transfer amount must be greater than 0.");
  }
});

//listening Server and Running server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
