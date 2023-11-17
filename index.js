const express = require('express')
const app = express()
const cors = require('cors')
require('dotenv').config()
const port = process.env.PORT || 5000
const jwt = require('jsonwebtoken')
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY)
const nodemailer = require('nodemailer')

// middleware
// const corsOptions = {
//   origin: '*',
//   credentials: true,
//   optionSuccessStatus: 200,
// }
app.use(cors())
app.use(express.json())

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zzcfrzy.mongodb.net/?retryWrites=true&w=majority`

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

const verifyjwt = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ error: true, messager: 'unauthorized access' })
  }
  const token = authorization.split(' ')[1]
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ error: true, messager: 'unauthorized access' })
    }
    req.decoded = decoded;
    next()
  })
}



//send email function
const sendMail = (emailData, emailAddress) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL,
      pass: process.env.PASS

    }
  })

  const mailOptions = {
    from: process.env.EMAIL,
    to: emailAddress,
    subject: emailData.subject,
    html: `<p>${emailData?.message}</p>`

  }

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log(error);
    }
    else {
      console.log('email sent', info.response);
    }
  })

}
async function run() {
  try {
    const usersCollection = client.db('aircncDb').collection('users')
    const roomsCollection = client.db('aircncDb').collection('rooms')
    const bookingsCollection = client.db('aircncDb').collection('bookings')



    //generate client secret
    app.post('/create-payment-intent', verifyjwt, async (req, res) => {
      const { price } = req.body;
      if (price) {
        const amount = parseFloat(price) * 100
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          payment_method_types: ['card']
        })
        res.send({ clientSecret: paymentIntent.client_secret })
      }
    })

    //generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
      console.log(token)
      res.send({ token })
    })

    //save user email and role in db
    app.put('/users/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email: email }
      const options = { upsert: true }
      const updatedDoc = {
        $set: user
      }
      console.log(updatedDoc)
      const result = await usersCollection.updateOne(query, updatedDoc, options)
      console.log(result)
      res.send(result)
    })


    //get user
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: email }
      const result = await usersCollection.findOne(query)
      res.send(result)
    })
    app.get('/users', async (req, res) => {
      // const email = req.params.email;
      // const query = { email: email }
      const result = await usersCollection.find().toArray()
      res.send(result)
    })





    //room realted info
    app.get('/rooms', async (req, res) => {
      const result = await roomsCollection.find().toArray()
      res.send(result)
    })


    //get one single room
    app.get('/room/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await roomsCollection.findOne(query)
      res.send(result)
    })

    //get host room

    app.get('/rooms/:email', verifyjwt, async (req, res) => {
      const decodedEmail = req.decoded.email
      console.log(decodedEmail)
      const email = req.params.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ error: true, messager: 'forbiddeen access' })
      }
      const query = { 'host.email': email }
      const result = await roomsCollection.find(query).toArray()
      res.send(result)

    })



    //save room to db
    app.post('/rooms', async (req, res) => {
      const room = req.body;
      console.log(room);
      const result = await roomsCollection.insertOne(room)
      res.send(result)
    })

    //update room info
    app.put('/rooms/:id', async (req, res) => {
      const id = req.params.id;
      const room = req.body
      const filter = { _id: new ObjectId(id) }
      const options = { upsert: true }
      const updatedDoc = {
        $set: room
      }
      const result = await roomsCollection.updateOne(filter, updatedDoc, options)
      res.send(result)
    })

    //delete a room

    app.delete('/rooms/:id', async (req, res) => {
      const id = req.params.id;
      console.log(id)
      const query = { _id: new ObjectId(id) }
      const result = await roomsCollection.deleteOne(query)
      res.send(result)
    })

    //bookings related info

    //get user boooings
    app.get('/bookings', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([])
      }
      const query = { 'guest.email': email }
      const result = await bookingsCollection.find(query).toArray()
      res.send(result)
    })

    //save a booking to db
    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const result = await bookingsCollection.insertOne(booking)


      //send confirmation email to guest email address
      sendMail(
        {
          subject: 'Booking Successful!',
          message: `Booking id: ${result?.insertedId}, TransactionId: ${booking?.transactionId}`,
        },
        booking?.guest?.email
      )

      //send confirmation email to host email address

      sendMail({
        subject: 'Your Room got Booked!',
        message: `Booking id: ${result?.insertedId}, TransactionId: ${booking?.transactionId}`,
      },
        booking?.host
      )
      res.send(result)
    })


    //get booking for host
    app.get('/bookings/host', async (req, res) => {
      const email = req.query.email;
      if (!email) {
        res.send([])
      }
      const query = { host: email }
      const result = await bookingsCollection.find().toArray()
      res.send(result)
    })



    //update booking status
    app.patch('/rooms/status/:id', async (req, res) => {
      const id = req.params.id;
      const status = req.body;
      const query = { _id: new ObjectId(id) }
      const updatedDoc = {
        $set: {
          booked: status
        }
      }
      const result = await roomsCollection.updateOne(query, updatedDoc)
      res.send(result)
    })

    //delete a booking
    app.delete('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await bookingsCollection.deleteOne(query)
      res.send(result)
    })


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir)

app.get('/home', (req, res) => {
  res.send('AirCNC Server is running..')
})

app.listen(port, () => {
  console.log(`AirCNC is running on port ${port}`)
})